
# AI Vision Drive – Hệ thống Hỗ trợ Lái xe Thông minh & Trung tâm Huấn luyện YOLO

## 1. Thông tin dự án

- **Tên dự án:** AI Vision Drive
- **Tên tác giả / nhóm:** Annd
- **Trường:** Trường Đại học Sư phạm Hà Nội (HNUE)
- **Lớp:** K74E1
- **Email:** stu745105001@hnue.edu.vn
- **GitHub:** https://github.com/khuaminh8-cyber/AI_VISION_DRIVE
- **Website Demo:** https://ai-vision-drive.vercel.app/

### Mục tiêu dự án

AI Vision Drive là hệ thống hỗ trợ lái xe thông minh ứng dụng trí tuệ nhân tạo và thị giác máy tính. Hệ thống hướng đến việc nhận diện các phương tiện, người đi bộ và tín hiệu giao thông, đồng thời ước lượng khoảng cách, theo dõi chuyển động và cảnh báo nguy cơ va chạm theo thời gian thực.

Dự án tích hợp Trung tâm huấn luyện YOLO, cho phép thu thập dữ liệu, gán nhãn, quản lý dataset, tạo cấu hình huấn luyện và xuất mô hình ONNX để triển khai trực tiếp trên trình duyệt.

---


## 2. Thông tin mô hình AI

### 2.1. Mô hình nhận diện

- **Framework:** Ultralytics
- **Model:** YOLO11n (Nano)
- **Model nền:** `yolo11n.pt`
- **Định dạng triển khai:** ONNX
- **ONNX Opset:** 12
- **Input shape:** `[1, 3, 640, 640]`
- **Image size:** 640 × 640 pixels
- **Data type:** Float32
- **Số lớp nhận diện:** 8

### 2.2. Danh sách lớp nhận diện

| Class ID | Nhãn | Đối tượng |
|---|---|---|
| 0 | person | Người đi bộ |
| 1 | bicycle | Xe đạp |
| 2 | car | Ô tô |
| 3 | motorcycle | Xe máy |
| 4 | bus | Xe buýt |
| 5 | truck | Xe tải |
| 6 | traffic_light | Đèn giao thông |
| 7 | stop_sign | Biển báo STOP |

### 2.3. Thông số huấn luyện

| Thông số | Giá trị |
|---|---|
| Model nền | yolo11n.pt |
| Epochs | 80 |
| Batch size | 16 |
| Image size | 640 |
| Optimizer | AdamW |
| Training platform | Google Colab |
| GPU mục tiêu | NVIDIA Tesla T4 |
| Output | best.pt / best.onnx |

### 2.4. Data Augmentation

Sử dụng các kỹ thuật tăng cường dữ liệu theo cấu hình Ultralytics:

- Mosaic Augmentation.
- Horizontal Flip.
- HSV Color Jitter.
- Scale Augmentation.

---

## 3. Dataset

### 3.1. Cấu trúc dữ liệu

Dataset được tổ chức theo định dạng YOLO:

```text
adas_dataset/
├── images/
│   ├── train/
│   └── val/
├── labels/
│   ├── train/
│   └── val/
└── data.yaml
```

### 3.2. Quy mô Dataset

Điền theo số lượng thực tế của bộ dữ liệu được sử dụng trong lần huấn luyện và nộp báo cáo:

- Tổng số ảnh: [8 hoặc 1.250 ảnh]
- Training images: [6 hoặc 1.000 ảnh]
- Validation images: [2 hoặc 250 ảnh]
- Số lớp nhận diện: 8.

### 3.3. Quy trình xây dựng Dataset

1. Thu thập hình ảnh hoặc video giao thông.
2. Trích xuất khung hình từ video.
3. Đưa dữ liệu vào Trung tâm huấn luyện.
4. Sử dụng AI Auto-label để hỗ trợ tạo nhãn.
5. Kiểm tra và chỉnh sửa bounding box.
6. Kiểm tra class ID và định dạng nhãn.
7. Chia tập Train và Validation.
8. Xuất dataset theo chuẩn YOLO để huấn luyện.

## 4. Thông tin Dataset

### 4.1. Nguồn dữ liệu

Dataset được xây dựng từ các nguồn:

- Video camera hành trình giao thông.
- Khung hình trích xuất từ video giao thông.
- Dữ liệu giao thông từ COCO.
- Dữ liệu bổ sung từ Roboflow và các bộ dữ liệu phương tiện giao thông Việt Nam.

### 4.2. Quy mô Dataset

| Thành phần | Số lượng |
|---|---:|
| Tổng số ảnh | 1.250 |
| Training images | 1.000 |
| Validation images | 250 |
| Số lớp nhận diện | 8 |
| Bounding boxes | Hơn 8.500 |

### 4.3. Danh sách đối tượng

| Class | Nội dung gán nhãn |
|---|---|
| person | Người đi bộ, người sang đường |
| bicycle | Xe đạp, xe đạp điện |
| car | Ô tô con, taxi, SUV |
| motorcycle | Xe máy, xe tay ga |
| bus | Xe buýt, xe khách |
| truck | Xe tải, xe ben, container |
| traffic_light | Đèn tín hiệu giao thông |
| stop_sign | Biển báo dừng STOP |

### 4.4. Quy trình gán nhãn

Quy trình gán nhãn được thực hiện theo hướng bán tự động:

1. Thu thập hình ảnh và trích xuất khung hình từ video.
2. Đưa hình ảnh vào Trung tâm huấn luyện.
3. Sử dụng chức năng AI Auto-label để tạo nhãn sơ bộ.
4. Kiểm tra và điều chỉnh bounding box.
5. Xác nhận class ID tương ứng.
6. Kiểm tra dữ liệu trước khi xuất dataset.
7. Xuất dataset theo cấu trúc YOLO để phục vụ huấn luyện.

---

## 5. Thông tin liên hệ

- **Dự án:** AI Vision Drive
- **Nhóm phát triển:** Annd
- **Email:** stu745105001@hnue.edu.vn
- **GitHub:** https://github.com/khuaminh8-cyber/AI_VISION_DRIVE
- **Demo:** https://ai-vision-drive.vercel.app/
