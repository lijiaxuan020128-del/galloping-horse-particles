# 奔马粒子（Galloping Horse Particles）

10 万个白色粒子在黑幕上周期性散开、聚合：聚拢时化作一匹
横向飞奔的骏马剪影，撒蹄跑上几步，随即再度散作星尘。

基于 Zaron Chen 的《靈》改造：保留原作的粒子运动公式与拖尾，
加入从参考视频提取的连续奔马轮廓帧，以及周期性的聚散节奏。
头颈俯仰已对照视频微调（聚拢抬头、伸展低头前探）。

## 在线观看

### 尘埃（滑动版）

**[点击直接打开滑动交互展示页](https://lijiaxuan020128-del.github.io/galloping-horse-particles/hover/)**

默认持续奔跑；鼠标滑过时，附近粒子自由游动约 3 秒，再逐渐归位。无需点击、无需登录，其他电脑也可以通过链接观看。

源项目：https://editor.p5js.org/lijiaxuan020128/full/jqPcnHcJi

### 原版：周期聚散与点击交互

<https://lijiaxuan020128-del.github.io/galloping-horse-particles/>

## 交互

- **散开时点击**：粒子立刻聚集成马
- **已成马时点击**：鼠标附近的粒子被冲击波打散，随后自动归位回马形
- **消散时点击**：立刻重新聚集成马

## 时间线（一个循环 8 秒）

| 阶段 | 时间 | 画面 |
| --- | --- | --- |
| 散开 | 0.0 ~ 4.0s | 粒子自由流动，无马形 |
| 聚合 | 4.0 ~ 5.5s | 马形渐显 |
| 奔跑 | 5.5 ~ 6.5s | 马形完整，循环奔跑 |
| 散开 | 6.5 ~ 8.0s | 马形渐隐，回到起点 |

- 四段时长在 `sketch.js` 顶部的 `HORSE_SETTINGS` 里调整，
  刷新后浏览器控制台会打印实际时间线。
- 马的步伐全程匀速连续：聚散过渡顺滑无停顿，
  每次奔跑都接续上一次的步伐，不重新开始。
- 步频由 `strideSeconds` 控制（越小跑得越快）。

## 运行

- 在线版直接打开上面的链接即可。
- 本地运行：把 `index.html` + `sketch.js` 放在同一目录，用浏览器打开 `index.html`
  （或放入 p5.js Web Editor 运行）。
- 需要支持 WebGL2 的浏览器。

## 致谢

- 原作：靈 © 2024-01-30 by Zaron Chen（CC BY-NC-SA 3.0）
- 原作灵感：gpfault.net/posts/webgl2-particles.txt.html
- 噪声函数：Shox 1.1.0
- 本作品按 CC BY-NC-SA 3.0 同方式共享
