#!/usr/bin/env python3
"""
proxy.py — Lightweight reverse proxy using only Python stdlib.
Routes /admin/* and /api/* to the admin server (PORT_ADMIN).
Routes everything else to the main server (PORT_MAIN).
Listens on PORT (Render's public-facing port).
"""
import os
import sys
import http.server
import http.client
import urllib.request
import urllib.parse
import threading
import socketserver

MAIN_PORT = int(os.environ.get('PORT_MAIN', '3000'))
ADMIN_PORT = int(os.environ.get('PORT_ADMIN', '5000'))
PROXY_PORT = int(os.environ.get('PORT', '8080'))

# Paths that only the main server handles (admin server doesn't have these routes)
MAIN_ONLY_PREFIXES = (
    '/api/public/products/featured',
    '/api/public/delivery-prices',
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
        # POST to customer-facing endpoints goes to the main server
        if method == 'POST':
            for mp in MAIN_POST_PATHS:
                if path == mp:
                    return ('127.0.0.1', MAIN_PORT)
        # These specific public routes are only on the main server
        for prefix in MAIN_ONLY_PREFIXES:
            if path.startswith(prefix):
                return ('127.0.0.1', MAIN_PORT)
        return ('127.0.0.1', ADMIN_PORT)
    return ('127.0.0.1', MAIN_PORT)


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """Forward requests to the appropriate backend server."""

    def _proxy(self):
        backend_host, backend_port = route_to_backend(self.path, self.command)
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            conn = http.client.HTTPConnection(backend_host, backend_port, timeout=30)

            # Forward headers (skip hop-by-hop)
            skip = {'host', 'connection', 'keep-alive', 'transfer-encoding'}
            fwd_headers = {}
            for k, v in self.headers.items():
                if k.lower() not in skip:
                    fwd_headers[k] = v

            conn.request(self.command, self.path, body=body, headers=fwd_headers)
            resp = conn.getresponse()

            self.send_response(resp.status)
            for key, val in resp.getheaders():
                k_lower = key.lower()
                if k_lower in ('transfer-encoding', 'connection'):
                    continue
                self.send_header(key, val)
            self.end_headers()

            # Stream response body
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()

            conn.close()
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'Proxy error: {e}'.encode())
            self.wfile.flush()

    def do_GET(self):
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
        # Quiet logging — only errors
        if args and str(args[0]).startswith('5'):
            sys.stderr.write(f"[proxy] {args[0]}\n")


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    print(f'[proxy] Routing /admin/* and /api/* → localhost:{ADMIN_PORT}')
    print(f'[proxy] Routing everything else → localhost:{MAIN_PORT}')
    print(f'[proxy] Listening on port {PROXY_PORT}')
    server = ThreadedHTTPServer(('0.0.0.0', PROXY_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[proxy] Stopped.')
        server.server_close()
