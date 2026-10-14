import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import { nanoid } from "nanoid";

const name = z.string().parse("app-a");
Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  fetch: () => Response.json({
    app: name,
    className: twMerge(clsx("px-2", "px-4")),
    idLength: nanoid().length
  })
});
