#!/usr/bin/env python3
"""
proxy.py — Lightweight reverse proxy using only Python stdlib.
Routes /admin/* to admin server (PORT_ADMIN).
Routes /api/public/* and POST /api/orders to main server (PORT_MAIN).
All other /api/* routes go to admin server (PORT_ADMIN).
Everything else goes to main server (PORT_MAIN).
Listens on PORT (Render's public-facing port).
Features: gzip compression for text payloads, threaded request handling.
"""
import os
import sys
import gzip
import http.server
import http.client
import urllib.request
import urllib.parse
import threading
import socketserver

MAIN_PORT = int(os.environ.get('PORT_MAIN', '3000'))
ADMIN_PORT = int(os.environ.get('PORT_ADMIN', '5000'))
PROXY_PORT = int(os.environ.get('PORT', '8080'))

COMPRESSIBLE_TYPES = (
    'text/html', 'text/css', 'text/javascript', 'text/plain', 'text/xml',
    'application/javascript', 'application/json', 'application/xml',
    'image/svg+xml',
)

# Paths that only the main server handles (admin server doesn't have these routes)
MAIN_ONLY_PREFIXES = (
    '/api/public/',
)

# POST routes that must go to the main server (customer-facing, no auth)
MAIN_POST_PATHS = (
    '/api/orders',
)


def route_to_backend(path, method='GET'):
    """Return (host, port) for the given request path and HTTP method."""
    if path.startswith('/admin/'):
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
    if not client_accepts_gzip:
        return False
    if not content_type:
        return False
    ct = content_type.split(';')[0].strip().lower()
    return any(ct.startswith(t) for t in COMPRESSIBLE_TYPES)


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """Forward requests to the appropriate backend server."""

    def _proxy(self):
        backend_host, backend_port = route_to_backend(self.path, self.command)
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            conn = http.client.HTTPConnection(backend_host, backend_port, timeout=30)

            skip = {'host', 'connection', 'keep-alive', 'transfer-encoding'}
            fwd_headers = {}
            for k, v in self.headers.items():
                if k.lower() not in skip:
                    fwd_headers[k] = v

            conn.request(self.command, self.path, body=body, headers=fwd_headers)
            resp = conn.getresponse()

            resp_body = resp.read()
            conn.close()

            client_gzip = 'gzip' in self.headers.get('Accept-Encoding', '')
            resp_ct = ''
            already_gzipped = False
            for k, v in resp.getheaders():
                if k.lower() == 'content-type':
                    resp_ct = v
                if k.lower() == 'content-encoding' and 'gzip' in v.lower():
                    already_gzipped = True

            do_compress = _should_compress(resp_ct, client_gzip) and not already_gzipped

            if do_compress:
                resp_body = gzip.compress(resp_body, compresslevel=6)

            self.send_response(resp.status)
            hop_skip = {'transfer-encoding', 'connection', 'content-encoding', 'content-length'}
            for key, val in resp.getheaders():
                if key.lower() in hop_skip:
                    continue
                self.send_header(key, val)

            if do_compress:
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_header('Vary', 'Accept-Encoding')

            self.end_headers()
            self.wfile.write(resp_body)
            self.wfile.flush()

        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'Proxy error: {e}'.encode())
            self.wfile.flush()

    def do_GET(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def log_message(self, format, *args):
        if args and str(args[0]).startswith('5'):
            sys.stderr.write(f"[proxy] {args[0]}\n")


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    print(f'[proxy] Routing /admin/* and most /api/* → localhost:{ADMIN_PORT}')
    print(f'[proxy] Routing /api/public/* and POST /api/orders → localhost:{MAIN_PORT}')
    print(f'[proxy] Routing everything else → localhost:{MAIN_PORT}')
    print(f'[proxy] Gzip compression enabled for text/json payloads')
    print(f'[proxy] Listening on port {PROXY_PORT}')
    server = ThreadedHTTPServer(('0.0.0.0', PROXY_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[proxy] Stopped.')
        server.server_close()
