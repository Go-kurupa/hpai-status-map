import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { routes } from "./routes";
import { installStaleChunkReload } from "./ui/staleChunk";
import "./ui/theme.css";

// 本番を出し直した後の、古い部品のファイルの読み込みの失敗は、1 回だけ読み込み直して直す
installStaleChunkReload();

const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
