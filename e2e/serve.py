# Static server for the browser tests: threaded, never cached, quiet.
# (python3 -m http.server stalled the odd module request under parallel test workers.)
import functools
import http.server
import socket
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # one request per connection: nothing waits on a kept-alive socket

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    # both IPv4 and IPv6, since Node resolves localhost to ::1
    address_family = socket.AF_INET6
    daemon_threads = True
    request_queue_size = 128

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


port = int(sys.argv[1])
root = sys.argv[2] if len(sys.argv) > 2 else "."
Server(("::", port), functools.partial(Handler, directory=root)).serve_forever()
