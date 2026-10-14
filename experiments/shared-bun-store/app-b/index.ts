import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import { format } from "date-fns";

const name = z.string().parse("app-b");
Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  fetch: () => Response.json({
    app: name,
    className: twMerge(clsx("px-2", "px-4")),
    date: format(new Date("2026-10-14T00:00:00Z"), "yyyy-MM-dd")
  })
});
