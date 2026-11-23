const staticDir = "./dist/client";

export function startServer(): void {
  Bun.serve({
    port: 3000,

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/hello") {
        return Response.json({ message: "hello from nooshare-cases" });
      }

      const path =
        url.pathname === "/"
          ? `${staticDir}/index.html`
          : `${staticDir}${url.pathname}`;

      const file = Bun.file(path);

      if (await file.exists()) {
        return new Response(file);
      }

      return new Response("Not Found", { status: 404 });
    }
  });

  console.log("Server: http://localhost:3000");
}

if (import.meta.main) {
  try {
    startServer();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
