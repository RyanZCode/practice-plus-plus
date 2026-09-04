import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(process.env.DIRECT_URL === undefined
    ? {}
    : {
        datasource: {
          url: process.env.DIRECT_URL,
        },
      }),
});
