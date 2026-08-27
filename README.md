# Bili2Nico

[中文](#bili2nico) / [日本語](#bili2nico-1)

> 在 B 站（Bilibili）上实现 N 站（Niconico/ニコニコ）弹幕播放逻辑的 Chrome 扩展。

Bili2Nico 是一个 Chrome (Manifest V3) 浏览器扩展，它从 B 站视频页抓取弹幕数据，
然后使用 Niconico 官方播放器兼容的弹幕引擎
[`@xpadev-net/niconicomments`](https://github.com/xpadev-net/niconicomments) v0.4.0 进行渲染，
把 B 站弹幕转换成 N 站风格（轨道布局、防重叠、上/下/中、单条逆向等）。

## 功能特性

- 仅在 B 站视频页（`https://www.bilibili.com/video/*`）生效；自动识别 `/video/BV...` 或 `/video/av...`，并支持分P：根据 `?p=N` 选择对应分P的弹幕。
- 弹幕来源可在「segment (protobuf) 优先」与「XML 优先」之间切换（默认 segment 优先，失败自动互相兜底）。
- 内置最小 protobuf 解码器，无需第三方 protobuf 库。
- 将 B 站弹幕属性转换为 N 站 `formatted` 输入：位置、字号、颜色、字体、单条逆向等。
- 使用 niconicomments 引擎绘制轨道、防重叠、上/下/中布局。
- 支持 B 站 `mode=6` 逆向弹幕的单条渲染（左到右）。
- 视频切换、播放/暂停/跳转自动同步。
- 弹幕渲染格式可在「N站（Niconico 风格）」与「B站（原生）」之间切换。
- 右下角实时日志面板：可清空、收起，并输出逆向弹幕原始属性与 fontsize 映射统计。

## 安装（Google Chrome）

> 需要 Chrome（或 Chromium / Edge）浏览器。不用编译，直接以「已解压的扩展」加载。

### 1. 获取代码

```bash
git clone <你的仓库地址>
cd Bili2Nico
```

> 如果没有 Git，也可以直接下载仓库 ZIP 并解压。

### 2. 打开扩展管理页

在地址栏输入并回车：

```text
chrome://extensions
```

### 3. 开启「开发者模式」

在页面右上角打开「开发者模式」开关。

### 4. 加载已解压的扩展

1. 点击「加载已解压的扩展程序」（Load unpacked）。
2. 选择本仓库中的 `extension` 目录（里面包含 `manifest.json`、`content.js`、`lib/` 等）。
3. 加载成功后，浏览器右上角会出现 **Bili2Nico** 图标。

### 5. 使用

1. 打开任意 B 站视频页，例如：

   ```text
   https://www.bilibili.com/video/BV1uW8B6KEE7
   ```

2. 扩展会抓取弹幕并渲染为 N 站风格；右下角日志面板顶部显示状态（如「Bili2Nico: 34 条弹幕」）。
3. 点击右上角 **Bili2Nico** 图标，可打开设置页进行配置。

## 设置项

| 设置 | 说明 | 默认值 |
| --- | --- | --- |
| `MAX_COMMENTS` | 交给引擎的弹幕总数上限，超出部分截取 | 5000 |
| `commentLimit` | 单帧绘制上限，超限优先保留较新弹幕 | 1000 |
| 弹幕来源优先级 | `segment`（protobuf）或 `XML` | `segment` |
| 弹幕渲染格式 | `N站（Niconico 风格）` 或 `B站（原生）` | `N站` |
| 弹幕字体 | `defont` / `gothic` / `mincho` | `defont` |
| 弹幕不透明度 | 0% 到 100%，拖动滑块实时更新 | 100% |
| `lazy` | 关闭惰性布局，预计算所有弹幕位置 | 关 |
| 显示右下角日志面板 | 是否显示调试日志面板 | 开 |

设置通过 `chrome.storage.sync` 持久化，刷新页面后依然生效。

## 原理

1. 从 URL 解析 `BV` / `av` 号。
2. 调用 `/x/web-interface/view` 获取 `cid`、`aid`、`duration`，失败时回退读取页面里的 `window.__INITIAL_STATE__`。
3. 按弹幕来源设置请求弹幕：
   - `segment`：`https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={cid}&pid={aid}&segment_index={i}`；
   - `XML`：`https://comment.bilibili.com/{cid}.xml`；
   其中一种返回空或失败时，自动改用另一种兜底。
4. 解析 protobuf 的 `DanmakuElem` 或 XML 的 `<d>` 节点。
5. 转换成 niconicomments 的 `formatted` 输入。
6. 在视频上方创建一个逻辑 1920x1080 的透明 canvas，用 `requestAnimationFrame` 驱动 `drawCanvas(video.currentTime * 100)`。

## B站 / N站 模式对照

| B站 `mode` | B站含义 | N站等价 | 说明 / 本扩展映射 |
| --- | --- | --- | --- |
| 1 / 2 / 3 | 普通滚动弹幕 | `naka` | 默认右到左 |
| 4 | 底部弹幕 | `shita` | 底部固定 |
| 5 | 顶部弹幕 | `ue` | 顶部固定 |
| 6 | 逆向弹幕 | 无单条等价（N站为 `@逆` 全局） | `naka` + `reverse:true`，左到右 |
| 7 | 高级弹幕 | 无直接等价 | 正文为 JSON，本扩展跳过 |
| 8 | 代码弹幕 | 无 | 本扩展跳过 |
| 9 | BAS 弹幕 | 无（B站特有） | 本扩展跳过 |

详细对比见 [`compare.html`](compare.html)。

### 字号映射

| B站 `fontsize` | N站字号指令 |
| --- | --- |
| ≤ 18 | `small` |
| ≤ 25 | `medium` |
| > 25 | `big`（36、64 等都归为 big） |

## 性能优化

- `MAX_COMMENTS`：控制交给引擎的弹幕总数，避免超大视频初始化卡死。
- `lazy`：默认开启惰性布局；可在设置页关闭以启用完整弹幕。
- `commentLimit`：限制单帧绘制条数，避免掉帧。
- 空弹幕视频会直接结束初始化。

## 限制

- 高级弹幕、代码弹幕、BAS 弹幕会被跳过。
- 仅针对普通视频页（BV / av）生效。
- HTML5 渲染下仅建议使用 `defont` / `gothic` / `mincho` 字体。

## 从源码构建

`lib/niconicomments.js` 由源码构建：

```bash
cd niconicomments-0.4.0
pnpm install
npx rolldown -c rolldown.config.mjs
# 产物：niconicomments-0.4.0/dist/bundle.js
# 复制到 extension/lib/niconicomments.js
```

扩展本身无需构建，直接按上面的「安装」步骤加载即可。

## 目录结构

```text
Bili2Nico/
├── extension/
│   ├── manifest.json          # MV3 扩展清单
│   ├── content.js             # 内容脚本：抓取/转换/渲染/覆盖层
│   ├── popup.html / popup.js  # 右上角设置页
│   ├── background.js          # 空 MV3 service worker
│   ├── lib/
│   │   └── niconicomments.js  # niconicomments v0.4.0 构建产物（UMD）
├── compare.html             # B站 / N站 弹幕模式与指令对比
└── niconicomments-0.4.0/     # 参考源码（可重新构建 lib）
```

## License

MIT（本扩展）。`niconicomments` 使用 [MIT License](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)。

## 专利提示

`niconicomments` 源码声明：使用它实现「实时弹幕获取 + 屏幕绘制 + 弹幕投稿」这一整套流程，
可能涉及 Dwango / Niconico 持有的专利，详见仓库内 `ABOUT_PATENT.md`。
本项目仅作学习与研究参考，商用前请自行评估合规风险。

## 参考

- [niconicomments](https://github.com/xpadev-net/niconicomments)
- [Bilibili API Collect - 弹幕文档](https://github.com/cps-open-source-fork/bilibili-API-collect)
- [CommentCoreLibrary - 弹幕类型说明](https://commentcorelibrary.readthedocs.io/en/latest/CommentTypes/)
- [W3C Danmaku Use Cases](https://w3c.github.io/danmaku/usecase.html)

---

# Bili2Nico

> B 站（Bilibili）の動画ページ上で、N 站（Niconico / ニコニコ）のコメント描画ロジックを再現する Chrome 拡張機能です。

Bili2Nico は Chrome (Manifest V3) ブラウザ拡張機能です。B 站の動画ページからコメント（弾幕）データを取得し、
Niconico 公式プレイヤー互換のコメント描画ライブラリ
[`@xpadev-net/niconicomments`](https://github.com/xpadev-net/niconicomments) v0.4.0 で描画します。
B 站のコメントを N 站風（レーン配置、重なり防止、上/中/下、単発リバースなど）に変換します。

## 機能

- B 站の動画ページ（`https://www.bilibili.com/video/*`）でのみ動作します。
- 分P対応：`?p=N` に応じて該当する分Pのコメント/`cid` を選択します。
- コメント取得元を「segment (protobuf) 優先」と「XML 優先」で切替（既定は segment、失敗時は自動で相互フォールバック）。
- 最小の protobuf デコーダを内蔵し、外部 protobuf ライブラリ不要。
- B 站のコメント属性を N 站 `formatted` 入力へ変換（位置、サイズ、色、フォント、単発リバースなど）。
- niconicomments の高性能エンジンで描画。
- B 站 `mode=6`（リバース）の単発描画に対応。
- 動画切替、再生/一時停止/シークに自動同期。
- レンダリング形式を「N站（Niconico 風）」と「B站（ネイティブ）」で切替可能。
- 右下にリアルタイムログパネル：クリア/折りたたみに対応し、リバース弾幕の原属性と fontsize マッピング統計を出力。

## インストール（Google Chrome）

> Chrome（または Chromium / Edge）が必要です。ビルド不要で「展開された拡張機能」として読み込みます。

### 1. ソースを取得

```bash
git clone <あなたのリポジトリURL>
cd Bili2Nico
```

> Git が無い場合は ZIP をダウンロードして解凍してください。

### 2. 拡張機能管理ページを開く

```text
chrome://extensions
```

### 3. 「デベロッパーモード」を有効にする

右上の「デベロッパーモード」を ON にします。

### 4. 展開された拡張機能を読み込む

1. 「パッケージ化されていない拡張機能を読み込む」(Load unpacked) をクリック。
2. このリポジトリの `extension` ディレクトリ（`manifest.json`、`content.js`、`lib/` などを含む）を選択。
3. 読み込み完了後、ブラウザ右上に **Bili2Nico** アイコンが表示されます。

### 5. 使い方

1. B 站の動画ページを開きます。例：

   ```text
   https://www.bilibili.com/video/BV1uW8B6KEE7
   ```

2. 拡張機能がコメントを取得し、N 站風に描画します。右下ログパネル上部に状態（`Bili2Nico: 34 条弹幕` など）が表示されます。
3. 右上の **Bili2Nico** アイコンをクリックすると設定ページを開けます。

## 設定項目

| 設定 | 説明 | 既定値 |
| --- | --- | --- |
| `MAX_COMMENTS` | エンジンへ渡すコメント総数の上限（超過分は切り捨て） | 5000 |
| `commentLimit` | 1 フレームあたりの描画上限（超過時は新しいコメントを優先） | 1000 |
| コメント取得元優先度 | `segment`（protobuf）または `XML` | `segment` |
| レンダリング形式 | `N站（Niconico 風）` または `B站（ネイティブ）` | `N站` |
| フォント | `defont` / `gothic` / `mincho` | `defont` |
| 不透明度 | 0%〜100%、スライダーでリアルタイム更新 | 100% |
| `lazy` | 惰性レイアウトを無効化し、全コメント位置を事前計算 | オフ |
| 右下ログパネル表示 | デバッグログパネルを表示するか | ON |

設定は `chrome.storage.sync` に保存され、リロード後も維持されます。

## 原理

1. URL から `BV` / `av` を解析。
2. `/x/web-interface/view` で `cid`、`aid`、`duration` を取得。失敗時はページ内の `window.__INITIAL_STATE__` を参照。
3. コメント取得元の設定に応じて取得：
   - `segment`：`https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={cid}&pid={aid}&segment_index={i}`；
   - `XML`：`https://comment.bilibili.com/{cid}.xml`；
   どちらかが空/失敗なら自動でもう一方へフォールバック。
4. protobuf の `DanmakuElem` または XML の `<d>` を解析。
5. niconicomments の `formatted` 入力に変換。
6. 1920x1080 論理座標の透明 canvas を動画上に置き、`requestAnimationFrame` で `drawCanvas(video.currentTime * 100)` を駆動。

## B站 / N站 モード対照

| B站 `mode` | B站 の意味 | N站 相当 | 説明 / 本拡張のマッピング |
| --- | --- | --- | --- |
| 1 / 2 / 3 | 通常スクロール | `naka` | 既定で右→左 |
| 4 | 下固定 | `shita` | 下固定 |
| 5 | 上固定 | `ue` | 上固定 |
| 6 | リバース | 単発相当なし（N站は `@逆` のグローバル） | `naka` + `reverse:true`、左→右 |
| 7 | 高度な弾幕 | 直接相当なし | 本体は JSON、本拡張ではスキップ |
| 8 | コード弾幕 | なし | スキップ |
| 9 | BAS 弾幕 | なし（B站 固有） | スキップ |

詳細は [`compare.html`](compare.html) を参照してください。

### サイズマッピング

| B站 `fontsize` | N站 サイズ指令 |
| --- | --- |
| ≤ 18 | `small` |
| ≤ 25 | `medium` |
| > 25 | `big`（36、64 なども big） |

## パフォーマンス

- `MAX_COMMENTS`：エンジンへ渡すコメント総数を制限し、巨大動画の初期化停止を防ぐ。
- `lazy`：既定で有効。設定で無効化すると全ての位置を事前計算。
- `commentLimit`：1 フレームの描画数を制限し、フレーム落ちを防ぐ。
- コメントが空の動画は初期化を即終了し、再試行しません。

## 制限

- 高度な弾幕、コード弾幕、BAS 弾幕はスキップ。
- 通常の動画ページ（BV / av）のみ対応。
- HTML5 描画では `defont` / `gothic` / `mincho` を推奨。

## ソースからのビルド

`lib/niconicomments.js` はソースから構築します：

```bash
cd niconicomments-0.4.0
pnpm install
npx rolldown -c rolldown.config.mjs
# 成果物：niconicomments-0.4.0/dist/bundle.js
# これを extension/lib/niconicomments.js にコピー
```

拡張機能自体はビルド不要で、上記「インストール」手順でそのまま読み込めます。

## ディレクトリ構成

```text
Bili2Nico/
├── extension/
│   ├── manifest.json          # MV3 拡張機能リスト
│   ├── content.js             # 取得/変換/描画/オーバーレイ
│   ├── popup.html / popup.js  # 設定ページ
│   ├── background.js          # 空の MV3 service worker
│   └── lib/
│       └── niconicomments.js  # niconicomments v0.4.0 ビルド成果物（UMD）
├── compare.html             # B站 / N站 モード・コマンド比較
└── niconicomments-0.4.0/     # 参考ソース（lib 再構築用）
```

## License

MIT（本拡張機能）。`niconicomments` は [MIT License](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)。

## 特許について

`niconicomments` のソースは、「リアルタイムコメント取得 + 画面描画 + コメント投稿」一式の実装が
Dwango / Niconico の特許に抵触する可能性があると注記しています（リポジトリ内 `ABOUT_PATENT.md` 参照）。
本プロジェクトは学習・研究目的のみ。商用利用時は法的リスクを自己評価してください。

## 参考

- [niconicomments](https://github.com/xpadev-net/niconicomments)
- [Bilibili API Collect - 弹幕文档](https://github.com/cps-open-source-fork/bilibili-API-collect)
- [CommentCoreLibrary - 弾幕タイプ説明](https://commentcorelibrary.readthedocs.io/en/latest/CommentTypes/)
- [W3C Danmaku Use Cases](https://w3c.github.io/danmaku/usecase.html)

