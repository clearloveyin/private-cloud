# ☁️ YunPan 云盘

一个自托管的个人文件服务器，将你的电脑硬盘变成可远程访问的私有云盘。手机浏览器即可上传、下载、预览文件，无需安装任何 App。

## 功能

- **文件管理** — 浏览、上传、下载、删除、新建文件夹
- **智能分类** — 上传时自动根据扩展名分入 `图片` / `视频` / `其它` 目录
- **图片网格** — 图片、视频目录以相册网格展示，点击全屏预览，支持左右滑动
- **视频封面** — 视频自动提取第一帧作为封面图
- **密码保护** — JWT 认证，所有 API 需登录后访问
- **二维码接入** — 启动后终端打印二维码，手机扫码即用
- **外网穿透** — 可配合 ngrok / frp 实现公网访问
- **暗色主题** — 深空黑 + 琥珀金配色，移动端优化的现代 UI

## 环境要求

- Python 3.10+
- macOS / Linux / Windows

## 本地部署

```bash
# 1. 克隆或下载项目
cd yunpan

# 2. 安装依赖
pip3 install -r requirements.txt

# 3. 修改配置（可选）
vim config.yaml
```

## 配置

编辑 `config.yaml`：

```yaml
server:
  host: 0.0.0.0        # 监听地址
  port: 8080            # 监听端口

storage:
  root_dir: /home/user/yunpan/uploads   # 文件存储根目录

auth:
  password: admin123    # 登录密码（务必修改）
  token_expire_hours: 168
```

## 启动

```bash
python3 server.py
```

启动后终端会显示访问地址和二维码，手机扫码或浏览器打开 `Network` 地址即可。

```
  ╔══════════════════════════════════════════╗
  ║           ☁️  YunPan 云盘                 ║
  ╠══════════════════════════════════════════╣
  ║  Local:   http://localhost:8080          ║
  ║  Network: http://192.168.1.5:8080        ║
  ║  Root:    /home/user/yunpan/uploads      ║
  ╚══════════════════════════════════════════╝
```

## 外网访问

局域网内手机连接同一 WiFi，用 `Network` 地址即可访问。

如需在 4G/5G 等外网环境下访问：

**方式一：ngrok（最简单）**

```bash
# 安装 ngrok 并运行
ngrok http 8080
# 获得公网 URL，如 https://xxx.ngrok.io
```

**方式二：frp 内网穿透**

在拥有公网 IP 的 VPS 上部署 frps，本地运行 frpc，将 8080 端口映射出去。

## 项目结构

```
yunpan/
├── server.py             # FastAPI 后端
├── config.yaml           # 配置文件
├── requirements.txt      # Python 依赖
├── run.sh                # 启动脚本
├── templates/
│   ├── login.html        # 登录页
│   └── index.html        # 主页
├── static/
│   ├── css/style.css     # 样式
│   └── js/app.js         # 前端逻辑
└── uploads/              # 默认文件存储目录
    ├── 图片/
    ├── 视频/
    ├── 其它/
    └── .thumbnails/      # 视频封面缓存
```

## 技术栈

- **后端**: FastAPI + Uvicorn + python-jose (JWT) + PyYAML
- **前端**: 原生 HTML/CSS/JS，无框架依赖
- **视频封面**: imageio-ffmpeg (内嵌 FFmpeg 二进制)
- **二维码**: qrcode

## License

MIT
