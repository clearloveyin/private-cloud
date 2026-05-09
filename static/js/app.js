const TOKEN_KEY = "yunpan_token";
var _m = {};

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || _m[TOKEN_KEY]; }
  catch (e) { return _m[TOKEN_KEY] || null; }
}
function setToken(t) {
  _m[TOKEN_KEY] = t;
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
}
function clearToken() {
  delete _m[TOKEN_KEY];
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

async function api(url, opts) {
  opts = opts || {};
  var h = Object.assign({}, opts.headers);
  var t = getToken();
  if (t) h["Authorization"] = "Bearer " + t;
  var res = await fetch(url, { method: opts.method, headers: h, body: opts.body });
  if (res.status === 401) { clearToken(); window.location.replace("/login"); throw new Error("Unauthorized"); }
  return res;
}

(function () {
  var pathname = window.location.pathname;

  /* ======== LOGIN PAGE ======== */
  if (pathname === "/login") {
    var form = document.getElementById("login-form");
    if (!form) return;
    var btn = document.getElementById("login-btn");
    var errEl = document.getElementById("login-error");
    var btnTxt = btn.querySelector(".btn-text");
    var btnSp = btn.querySelector(".btn-spinner");
    var pwInput = document.getElementById("password");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = pwInput.value;
      if (!pw) return;
      btnTxt.classList.add("hidden");
      btnSp.classList.remove("hidden");
      btn.disabled = true;
      errEl.textContent = "";

      var fd = new FormData();
      fd.append("password", pw);
      fetch("/api/token", { method: "POST", body: fd }).then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.detail || "密码错误"); });
        return res.json();
      }).then(function (data) {
        setToken(data.access_token);
        window.location.replace("/");
      }).catch(function (ex) {
        errEl.textContent = ex.message;
        btnTxt.classList.remove("hidden");
        btnSp.classList.add("hidden");
        btn.disabled = false;
        pwInput.focus();
      });
    });
    return;
  }

  /* ======== MAIN APP ======== */
  if (pathname !== "/") return;

  if (!getToken()) { window.location.replace("/login"); return; }

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    back: $("btn-back"),
    crumbs: $("breadcrumbs"),
    logout: $("btn-logout"),
    loading: $("loading"),
    empty: $("empty"),
    fileList: $("file-list"),
    disk: $("disk-info"),
    uploadBtn: $("btn-upload"),
    mkdirBtn: $("btn-mkdir"),
    fileInput: $("file-input"),
    toast: $("toast"),
    overlay: $("dialog-overlay"),
    dialogMsg: $("dialog-msg"),
    dialogOk: $("dialog-confirm"),
    dialogNo: $("dialog-cancel")
  };

  var currentPath = "";
  var progressBar = null;
  var progressText = null;

  /* Toast */
  function toast(msg, cls) {
    cls = cls || "";
    el.toast.textContent = msg;
    el.toast.className = "toast " + cls + " show";
    clearTimeout(el.toast._tid);
    el.toast._tid = setTimeout(function () { el.toast.className = "toast hidden"; }, 2200);
  }

  /* Dialog */
  function confirm(msg, cb) {
    el.dialogMsg.textContent = msg;
    el.overlay.classList.remove("hidden");
    el.dialogOk.onclick = function () { el.overlay.classList.add("hidden"); cb(); };
    el.dialogNo.onclick = function () { el.overlay.classList.add("hidden"); };
  }

  /* Breadcrumbs */
  function renderCrumbs(path) {
    el.crumbs.innerHTML = "";
    var parts = path ? path.split("/").filter(Boolean) : [];
    var home = document.createElement("span");
    home.className = "breadcrumb-item" + (parts.length === 0 ? " breadcrumb-current" : "");
    home.textContent = "首页";
    home.addEventListener("click", function () { loadFiles(""); });
    el.crumbs.appendChild(home);

    parts.forEach(function (p, i) {
      var sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      el.crumbs.appendChild(sep);
      var seg = parts.slice(0, i + 1).join("/");
      var sp = document.createElement("span");
      sp.className = "breadcrumb-item" + (i === parts.length - 1 ? " breadcrumb-current" : "");
      sp.textContent = p;
      sp.addEventListener("click", function () { loadFiles(seg); });
      el.crumbs.appendChild(sp);
    });
  }

  /* Icons */
  var ICONS = {
    folder: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    image: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    file: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
  };

  var IMG_EXT = ["jpg","jpeg","png","gif","webp","svg","bmp","heic"];

  function getIconHTML(item) {
    if (item.type === "folder") return ICONS.folder;
    var ext = item.name.split(".").pop().toLowerCase();
    if (IMG_EXT.indexOf(ext) !== -1) return ICONS.image;
    return ICONS.file;
  }

  function getIconClass(item) {
    if (item.type === "folder") return "folder";
    var ext = item.name.split(".").pop().toLowerCase();
    if (IMG_EXT.indexOf(ext) !== -1) return "image";
    return "doc";
  }

  /* Render */
  var galleryCache = {};

  function renderFiles(data) {
    el.loading.classList.add("hidden");
    if (!data.items || data.items.length === 0) {
      el.empty.classList.remove("hidden");
      el.fileList.classList.add("hidden");
      return;
    }
    el.empty.classList.add("hidden");
    el.fileList.classList.remove("hidden");
    el.fileList.innerHTML = "";

    var isRoot = (currentPath === "");
    var CATS = ["图片", "视频", "其它"];
    var isGallery = (!isRoot && (currentPath === "图片" || currentPath === "视频"));

    if (isGallery) {
      el.fileList.className = "gallery";
      galleryCache[currentPath] = [];
      data.items.forEach(function (item) {
        if (item.type === "folder") return;
        var rel = currentPath + "/" + item.name;
        var isVid = (currentPath === "视频");
        var isImg = (getIconClass(item) === "image");
        galleryCache[currentPath].push({ path: rel, name: item.name, type: isImg ? "image" : "video" });

        var tile = document.createElement("div");
        tile.className = "gallery-item";

        var token = getToken();
        var img = document.createElement("img");
        if (isImg) {
          img.src = "/api/download?path=" + encodeURIComponent(rel) + "&token=" + token;
        } else if (isVid) {
          img.src = "/api/thumbnail?path=" + encodeURIComponent(rel) + "&token=" + token;
        } else {
          img.src = "/api/download?path=" + encodeURIComponent(rel) + "&token=" + token;
        }
        img.alt = item.name;
        img.loading = "lazy";
        img.onerror = function () { this.style.display = "none"; };
        tile.appendChild(img);

        if (isVid) {
          var vi = document.createElement("div");
          vi.className = "gallery-video-icon";
          vi.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
          tile.appendChild(vi);
        }

        tile.addEventListener("click", function () {
          openLightbox(rel, item);
        });
        el.fileList.appendChild(tile);
      });
      return;
    }

    el.fileList.className = "file-list";

    data.items.forEach(function (item) {
      var isCategory = (isRoot && CATS.indexOf(item.name) !== -1);

      var row = document.createElement("div");
      row.className = "file-item";

      var iconWrap = document.createElement("div");
      iconWrap.className = "file-icon " + getIconClass(item);
      iconWrap.innerHTML = getIconHTML(item);

      var info = document.createElement("div");
      info.className = "file-info";

      var nameEl = document.createElement("div");
      nameEl.className = "file-name";
      nameEl.textContent = item.name;

      var meta = document.createElement("div");
      meta.className = "file-meta";
      var parts = [];
      if (isCategory && item.file_count !== undefined) {
        parts.push(item.file_count + " 个文件");
      } else if (item.size_display) {
        parts.push(item.size_display);
      }
      if (!isCategory) parts.push(item.modified);
      meta.textContent = parts.join(" · ");

      info.appendChild(nameEl);
      info.appendChild(meta);

      if (!isCategory) {
        var dlBtn = document.createElement("button");
        dlBtn.className = "file-download";
        dlBtn.title = "下载";
        dlBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        dlBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          var rel = currentPath ? currentPath + "/" + item.name : item.name;
          downloadFile(rel);
        });

        var delBtn = document.createElement("button");
        delBtn.className = "file-delete";
        delBtn.title = "删除";
        delBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        delBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          var rel = currentPath ? currentPath + "/" + item.name : item.name;
          confirm("确认删除「" + item.name + "」？", function () { deleteItem(rel); });
        });

        row.appendChild(iconWrap);
        row.appendChild(info);
        row.appendChild(dlBtn);
        row.appendChild(delBtn);
      } else {
        row.appendChild(iconWrap);
        row.appendChild(info);
      }

      row.addEventListener("click", function () {
        var rel = currentPath ? currentPath + "/" + item.name : item.name;
        if (item.type === "folder") { loadFiles(rel); }
        else if (getIconClass(item) === "image") { openLightbox(rel, item); }
        else { downloadFile(rel); }
      });

      el.fileList.appendChild(row);
    });
  }

  /* Lightbox */
  var lb = {
    overlay: document.getElementById("lightbox"),
    img: document.getElementById("lightbox-img"),
    video: document.getElementById("lightbox-video"),
    spinner: document.getElementById("lightbox-spinner"),
    name: document.getElementById("lightbox-name"),
    prevBtn: document.getElementById("lightbox-prev"),
    nextBtn: document.getElementById("lightbox-next"),
    closeBtn: document.getElementById("lightbox-close"),
    dlBtn: document.getElementById("lightbox-dl"),
    delBtn: document.getElementById("lightbox-del"),
    toolbar: document.getElementById("lightbox-toolbar"),
    media: [],
    index: -1
  };

  function openLightbox(path, item) {
    // Collect media from current dir: both images and videos
    lb.media = [];
    lb.index = -1;

    // Use galleryCache if available, otherwise scan list
    if (galleryCache[currentPath]) {
      lb.media = galleryCache[currentPath].map(function (m) {
        return { path: m.path, name: m.name, isVideo: m.type === "video" };
      });
    } else {
      var rows = el.fileList.querySelectorAll(".file-item");
      rows.forEach(function (r) {
        var iconCls = r.querySelector(".file-icon");
        if (iconCls && (iconCls.classList.contains("image") || iconCls.classList.contains("doc"))) {
          var nameEl = r.querySelector(".file-name");
          var fname = nameEl ? nameEl.textContent : "";
          var isVid = iconCls.classList.contains("doc");
          var rel = currentPath ? currentPath + "/" + fname : fname;
          lb.media.push({ path: rel, name: fname, isVideo: isVid });
        }
      });
    }

    for (var i = 0; i < lb.media.length; i++) {
      if (lb.media[i].path === path || lb.media[i].name === item.name) {
        lb.index = i;
        break;
      }
    }
    if (lb.index === -1) { lb.media.push({ path: path, name: item.name, isVideo: false }); lb.index = 0; }

    lb.overlay.classList.remove("hidden");
    showLightboxMedia(lb.media[lb.index]);
  }

  function showLightboxMedia(info) {
    lb.spinner.classList.remove("hidden");
    lb.img.classList.remove("loaded");
    lb.img.style.display = "none";
    lb.video.style.display = "none";
    lb.name.textContent = info.name;
    updateNavButtons();
    lb.toolbar.style.display = "";

    var token = getToken();
    var url = "/api/download?path=" + encodeURIComponent(info.path) + "&token=" + token;

    if (info.isVideo) {
      lb.video.onloadeddata = null;
      lb.video.onerror = null;
      lb.video.style.display = "";
      lb.video.onloadeddata = function () {
        lb.spinner.classList.add("hidden");
        lb.video.classList.add("loaded");
      };
      lb.video.onerror = function () {
        lb.spinner.classList.add("hidden");
        toast("加载失败", "error");
      };
      lb.video.src = url;
    } else {
      lb.img.style.display = "";
      var pre = new Image();
      pre.onload = function () {
        lb.img.src = url;
        lb.spinner.classList.add("hidden");
        lb.img.classList.add("loaded");
      };
      pre.onerror = function () {
        lb.spinner.classList.add("hidden");
        toast("加载失败", "error");
      };
      pre.src = url;
    }
  }

  function updateNavButtons() {
    lb.prevBtn.style.display = lb.index > 0 ? "" : "none";
    lb.nextBtn.style.display = lb.index < lb.media.length - 1 ? "" : "none";
  }

  function closeLightbox() {
    lb.overlay.classList.add("hidden");
    if (lb.img._prevUrl) { URL.revokeObjectURL(lb.img._prevUrl); lb.img._prevUrl = null; }
    lb.img.src = "";
    lb.video.src = "";
    lb.video.style.display = "none";
    lb.img.style.display = "none";
  }

  lb.closeBtn.addEventListener("click", closeLightbox);
  lb.overlay.addEventListener("click", function (e) {
    if (e.target === lb.overlay) closeLightbox();
  });

  lb.prevBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (lb.index > 0) { lb.index--; showLightboxMedia(lb.media[lb.index]); }
  });

  lb.nextBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (lb.index < lb.media.length - 1) { lb.index++; showLightboxMedia(lb.media[lb.index]); }
  });

  lb.dlBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var info = lb.media[lb.index];
    if (info) downloadFile(info.path);
  });

  lb.delBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var info = lb.media[lb.index];
    if (!info) return;
    closeLightbox();
    confirm("确认删除「" + info.name + "」？", function () {
      deleteItem(info.path);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (lb.overlay.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft" && lb.index > 0) { lb.index--; showLightboxMedia(lb.media[lb.index]); }
    if (e.key === "ArrowRight" && lb.index < lb.media.length - 1) { lb.index++; showLightboxMedia(lb.media[lb.index]); }
  });

  var swipeStartX = 0;
  lb.overlay.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) swipeStartX = e.touches[0].clientX;
  });

  lb.overlay.addEventListener("touchend", function (e) {
    if (lb.overlay.classList.contains("hidden")) return;
    var dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : 0) - swipeStartX;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && lb.index < lb.media.length - 1) { lb.index++; showLightboxMedia(lb.media[lb.index]); }
    if (dx > 0 && lb.index > 0) { lb.index--; showLightboxMedia(lb.media[lb.index]); }
  });

  /* Load */
  function loadFiles(path) {
    currentPath = path;
    renderCrumbs(path);
    el.loading.classList.remove("hidden");
    el.empty.classList.add("hidden");
    el.fileList.classList.add("hidden");
    el.back.style.visibility = path ? "visible" : "hidden";

    api("/api/files?path=" + encodeURIComponent(path)).then(function (res) {
      return res.json();
    }).then(function (data) {
      renderFiles(data);
    }).catch(function (ex) {
      el.loading.classList.add("hidden");
      el.empty.classList.remove("hidden");
      el.empty.querySelector(".empty-text").textContent = "加载失败";
      el.empty.querySelector(".empty-hint").textContent = ex.message || "请刷新页面重试";
    });
  }

  /* Download */
  function downloadFile(path) {
    var token = getToken();
    fetch("/api/download?path=" + encodeURIComponent(path), {
      headers: { Authorization: "Bearer " + token }
    }).then(function (res) {
      if (!res.ok) throw new Error("Download failed");
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(function () {
      toast("下载失败", "error");
    });
  }

  /* Delete */
  function deleteItem(path) {
    api("/api/files?path=" + encodeURIComponent(path), { method: "DELETE" }).then(function (res) {
      if (!res.ok) throw new Error("Delete failed");
      toast("已删除");
      loadFiles(currentPath);
    }).catch(function () {
      toast("删除失败", "error");
    });
  }

  /* Upload */
  var IMG_EXT2 = ["jpg","jpeg","png","gif","webp","svg","bmp","heic","ico","tiff","raw","cr2","nef"];
  var VID_EXT2 = ["mp4","mov","avi","mkv","wmv","flv","webm","m4v","3gp","mpg","mpeg","ts","rmvb"];

  function getCategory(filename) {
    var ext = filename.split(".").pop().toLowerCase();
    if (IMG_EXT2.indexOf(ext) !== -1) return "图片";
    if (VID_EXT2.indexOf(ext) !== -1) return "视频";
    return "其它";
  }

  function uploadFiles(files) {
    if (!files || files.length === 0) return;

    var groups = { "图片": [], "视频": [], "其它": [] };
    for (var i = 0; i < files.length; i++) {
      groups[getCategory(files[i].name)].push(files[i]);
    }

    var totalCount = files.length;
    var doneCount = 0;
    var hasError = false;

    showProgress();
    progressText.textContent = "上传中 0%";

    function showProgress() {
      var pb = document.querySelector(".upload-progress");
      if (!pb) {
        pb = document.createElement("div");
        pb.className = "upload-progress";
        pb.innerHTML = '<div class="upload-progress-bar"></div>';
        document.body.appendChild(pb);
        progressBar = pb.querySelector(".upload-progress-bar");
        progressText = document.createElement("div");
        progressText.className = "upload-progress-text";
        document.body.appendChild(progressText);
      } else {
        progressBar = pb.querySelector(".upload-progress-bar");
        progressText = document.querySelector(".upload-progress-text");
      }
      progressBar.style.width = "0%";
      progressText.classList.remove("hidden");
      pb.classList.remove("hidden");
    }

    function uploadGroup(category, groupFiles) {
      return new Promise(function (resolve, reject) {
        if (groupFiles.length === 0) { resolve(); return; }

        var fd = new FormData();
        fd.append("path", category);
        for (var i = 0; i < groupFiles.length; i++) fd.append("files", groupFiles[i]);

        var token = getToken();
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.setRequestHeader("Authorization", "Bearer " + token);

        xhr.addEventListener("load", function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            doneCount += groupFiles.length;
            var pct = Math.round(doneCount / totalCount * 100);
            progressBar.style.width = pct + "%";
            progressText.textContent = "上传中 " + pct + "%";
            resolve();
          } else {
            hasError = true;
            resolve();
          }
        });

        xhr.addEventListener("error", function () {
          hasError = true;
          resolve();
        });

        xhr.send(fd);
      });
    }

    Promise.all([
      uploadGroup("图片", groups["图片"]),
      uploadGroup("视频", groups["视频"]),
      uploadGroup("其它", groups["其它"])
    ]).then(function () {
      cleanProgress();
      if (hasError) {
        toast("部分文件上传失败", "error");
      } else {
        toast("已上传 " + totalCount + " 个文件");
      }
      loadFiles(currentPath);
    });
  }

  function cleanProgress() {
    var pb = document.querySelector(".upload-progress");
    if (pb) { pb.classList.add("hidden"); setTimeout(function () { pb.remove(); }, 500); }
    var pt = document.querySelector(".upload-progress-text");
    if (pt) { pt.classList.add("hidden"); setTimeout(function () { pt.remove(); }, 500); }
  }

  /* Mkdir */
  function createFolder() {
    var name = prompt("请输入文件夹名称：");
    if (!name || !name.trim()) return;
    name = name.trim();
    var fd = new FormData();
    fd.append("path", currentPath);
    fd.append("name", name);
    api("/api/mkdir", { method: "POST", body: fd }).then(function (res) {
      if (!res.ok) throw new Error("Create failed");
      toast("文件夹已创建");
      loadFiles(currentPath);
    }).catch(function (ex) {
      toast("创建失败: " + ex.message, "error");
    });
  }

  /* Disk info */
  function loadDisk() {
    api("/api/disk").then(function (res) {
      return res.json();
    }).then(function (d) {
      el.disk.innerHTML = "可用 <strong>" + d.free + "</strong> / <strong>" + d.total + "</strong>";
    }).catch(function () {
      el.disk.textContent = "";
    });
  }

  /* Events */
  el.back.addEventListener("click", function () {
    if (!currentPath) return;
    var parts = currentPath.split("/");
    parts.pop();
    loadFiles(parts.join("/"));
  });

  el.uploadBtn.addEventListener("click", function () { el.fileInput.click(); });
  el.fileInput.addEventListener("change", function () {
    if (el.fileInput.files.length > 0) {
      uploadFiles(el.fileInput.files);
      el.fileInput.value = "";
    }
  });

  el.mkdirBtn.addEventListener("click", createFolder);
  el.logout.addEventListener("click", function () {
    clearToken();
    window.location.href = "/login";
  });

  el.overlay.addEventListener("click", function (e) {
    if (e.target === el.overlay) el.overlay.classList.add("hidden");
  });

  loadFiles("");
  loadDisk();
})();
