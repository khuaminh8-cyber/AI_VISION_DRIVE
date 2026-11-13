import { createFileRoute } from "@tanstack/react-router";
import TrainingCenter from "@/components/training/TrainingCenter";

export const Route = createFileRoute("/training")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI Training Center — Quản lý dataset YOLO | AI Vision Drive" },
      { name: "description", content: "Tải ảnh, video giao thông, trích xuất khung hình và chuẩn bị dataset để fine-tune YOLO cho AI Vision Drive." },
      { property: "og:title", content: "AI Training Center — Quản lý dataset YOLO" },
      { property: "og:description", content: "Chuẩn bị dữ liệu giao thông Việt Nam cho huấn luyện YOLO ngay trên trình duyệt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrainingCenter,
});
