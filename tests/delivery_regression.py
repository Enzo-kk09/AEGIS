"""Validate the static delivery independently of the local Python service."""
import argparse
import importlib.util
import sys
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(".runtime/aegis3t-visual"))
    parser.add_argument("--base-url")
    args = parser.parse_args()
    server = None
    if args.base_url:
        base = args.base_url.rstrip("/")
    else:
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(args.root.resolve())))
        Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
    sys.argv = [sys.argv[0], "--base-url", base]
    spec = importlib.util.spec_from_file_location("delivery_browser", Path(__file__).with_name("browser_regression.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.PAGES.pop("DeveloperTest.html")
    names = [name for name in unittest.defaultTestLoader.getTestCaseNames(module.BrowserRegression) if not name.startswith("test_developer")]
    suite = unittest.TestSuite(module.BrowserRegression(name) for name in names)
    try:
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        if server:
            server.shutdown()
            server.server_close()
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
