#!/usr/bin/env python3
"""
proxy.py — Lightweight streaming reverse proxy using only Python stdlib.
Routes /admin/* to admin server (PORT_ADMIN).
Routes /api/public/* and POST /api/orders to main server (PORT_MAIN).
All other /api/* routes go to admin server (PORT_ADMIN).
Everything else goes to main server (PORT_MAIN).
Listens on PORT (Render's public-facing port).
Features: gzip compression, threaded requests, streaming body transfer.
"""
import os
import sys
import gzip
import http.server
import http.client
import socketserver

MAIN_PORT = int(os.environ.get('PORT_MAIN', '3000'))
ADMIN_PORT = int(os.environ.get('PORT_ADMIN', '5000'))
PROXY_PORT = int(os.environ.get('PORT', '8080'))

CHUNK_SIZE = 64 * 1024  # 64 KB streaming buffer

COMPRESSIBLE_TYPES = (
    'text/html', 'text/css', 'text/javascript', 'text/plain', 'text/xml',
    'application/javascript', 'application/json', 'application/xml',
    'image/svg+xml',
)

MAIN_ONLY_PREFIXES = (
    '/api/public/',
    '/api/health',
)

MAIN_POST_PATHS = (
    '/api/orders',
)

MAX_PROXY_BODY = 50 * 1024 * 1024  # 50 MB max request body


def route_to_backend(path, method='GET', referer=''):
    if (path.startswith('/admin') or
            path.startswith('/api/admin') or
            path.startswith('/notifications') or
            path.startswith('/logout') or
            '/admin' in referer):
        return ('127.0.0.1', ADMIN_PORT)
    if path.startswith('/api/'):
        if method == 'POST':
            for mp in MAIN_POST_PATHS:
                if path == mp:
                    return ('127.0.0.1', MAIN_PORT)
        for prefix in MAIN_ONLY_PREFIXES:
            if path.startswith(prefix):
                return ('127.0.0.1', MAIN_PORT)
        return ('127.0.0.1', ADMIN_PORT)
    return ('127.0.0.1', MAIN_PORT)


def _should_compress(content_type, client_accepts_gzip):
    if not client_accepts_gzip or not content_type:
        return False
    ct = content_type.split(';')[0].strip().lower()
    return any(ct.startswith(t) for t in COMPRESSIBLE_TYPES)


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except Exception as err:
            print(f"!!! PROXY REQUEST CRASH !!! {err}")
            import traceback; traceback.print_exc()
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Proxy error: {err}'.encode())
            except Exception:
                pass

    def log_message(self, format, *args):
        if args and str(args[0]).startswith('5'):
            sys.stderr.write(f"[proxy] {args[0]}\n")

    def _proxy(self):
        referer = self.headers.get('Referer', '')
        backend_host, backend_port = route_to_backend(self.path, self.command, referer)
        origin = 'Admin' if (self.path.startswith('/admin') or '/admin' in referer) else 'Main'
        print(f"[proxy] {self.command} {self.path} -> port {backend_port} ({origin})")
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > MAX_PROXY_BODY:
                self.send_response(413)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'Request too large')
                return

            upstream_conn = http.client.HTTPConnection(backend_host, backend_port, timeout=60)

            skip = {'host', 'connection', 'keep-alive', 'transfer-encoding'}
            client_ip = self.client_address[0]
            upstream_conn.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            upstream_conn.putheader('Host', f'127.0.0.1:{backend_port}')
            upstream_conn.putheader('X-Real-For', client_ip)
            for k, v in self.headers.items():
                if k.lower() not in skip:
                    upstream_conn.putheader(k, v)
            upstream_conn.endheaders()

            if content_length > 0:
                remaining = content_length
                while remaining > 0:
                    to_read = min(remaining, CHUNK_SIZE)
                    chunk = self.rfile.read(to_read)
                    if not chunk:
                        break
                    upstream_conn.send(chunk)
                    remaining -= len(chunk)

            upstream_resp = upstream_conn.getresponse()

            client_gzip = 'gzip' in self.headers.get('Accept-Encoding', '')
            resp_ct = ''
            resp_ctype_header = None
            already_gzipped = False
            for k, v in upstream_resp.getheaders():
                kl = k.lower()
                if kl == 'content-type':
                    resp_ct = v
                    resp_ctype_header = (k, v)
                if kl == 'content-encoding' and 'gzip' in v.lower():
                    already_gzipped = True

            do_compress = _should_compress(resp_ct, client_gzip) and not already_gzipped

            if do_compress:
                resp_body = upstream_resp.read()
                resp_body = gzip.compress(resp_body, compresslevel=6)

                self.send_response(upstream_resp.status, upstream_resp.reason)
                hop_skip = {'transfer-encoding', 'connection', 'content-encoding', 'content-length'}
                for k, v in upstream_resp.getheaders():
                    if k.lower() not in hop_skip:
                        self.send_header(k, v)
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_header('Vary', 'Accept-Encoding')
                self.end_headers()
                self.wfile.write(resp_body)
                self.wfile.flush()
            else:
                hop_skip = {'transfer-encoding', 'connection', 'content-encoding', 'content-length'}
                self.send_response(upstream_resp.status, upstream_resp.reason)
                has_content_length = False
                for k, v in upstream_resp.getheaders():
                    kl = k.lower()
                    if kl in hop_skip:
                        continue
                    if kl == 'content-length':
                        has_content_length = True
                    self.send_header(k, v)
                if not has_content_length:
                    self.send_header('Connection', 'close')
                self.end_headers()

                while True:
                    chunk = upstream_resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                self.wfile.flush()

            upstream_conn.close()

        except Exception as e:
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Proxy error: {e}'.encode())
                self.wfile.flush()
            except Exception:
                pass

    def do_GET(self): self._proxy()
    def do_HEAD(self): self._proxy()
    def do_POST(self): self._proxy()
    def do_PUT(self): self._proxy()
    def do_DELETE(self): self._proxy()
    def do_PATCH(self): self._proxy()
    def do_OPTIONS(self): self._proxy()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    print(f'[proxy] Routing /admin/* and most /api/* → localhost:{ADMIN_PORT}')
    print(f'[proxy] Routing /api/public/* and POST /api/orders → localhost:{MAIN_PORT}')
    print(f'[proxy] Routing everything else → localhost:{MAIN_PORT}')
    print(f'[proxy] Streaming mode: {CHUNK_SIZE // 1024}KB chunks, gzip compression enabled')
    print(f'[proxy] Listening on port {PROXY_PORT}')
    server = ThreadedHTTPServer(('0.0.0.0', PROXY_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[proxy] Stopped.')
        server.server_close()
