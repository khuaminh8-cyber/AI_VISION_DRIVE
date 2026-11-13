import { createFileRoute } from "@tanstack/react-router";
import Dashboard from "@/components/adas/Dashboard";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI Vision Drive — Mô phỏng hỗ trợ lái xe AI" },
      { name: "description", content: "Camera hành trình AI: nhận diện vật thể, theo dõi xe, hỗ trợ giữ làn, cảnh báo va chạm và cảnh 3D trực tiếp." },
      { property: "og:title", content: "AI Vision Drive — Mô phỏng hỗ trợ lái xe AI" },
      { property: "og:description", content: "Camera, màn hình hoặc video → AI nhận diện xe, làn đường, cảnh báo va chạm và mô phỏng 3D ngay trên trình duyệt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});
