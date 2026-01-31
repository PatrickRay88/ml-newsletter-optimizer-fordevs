const http = require("http");

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("ok");
});

const port = 4000;
server.listen(port, "127.0.0.1", () => {
  console.log(`simple server listening on http://127.0.0.1:${port}`);
});
