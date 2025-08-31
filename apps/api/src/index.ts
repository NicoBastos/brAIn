import Fastify from "fastify";
const app = Fastify();

app.get("/health", async () => ({ ok: true, service: "api" }));

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`API up on http://localhost:${port}`);
});
app.get('/', (req, rep) => {
  rep.send({hello:"world"})
})