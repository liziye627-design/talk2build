# Tencent Meeting reference

Study of the real Tencent Meeting desktop client (腾讯会议), used as the visual target for Talk2Build. Official help text is quoted from Tencent’s own pages. Colors marked **sampled** were read from pixels in a public client screenshot. Colors marked **reconstructed** match the dark in-meeting stage described by the official layout diagrams, but those diagrams are letterboxed and were not a clean toolbar sample.

## Sources

- Desktop quick-start (home, join, quick meeting, schedule, meeting list, end meeting): [腾讯会议桌面端快速使用指南](https://meeting.tencent.com/support/topic/1759/)
- Same home structure on Tencent Cloud docs: [腾讯会议 PC 端](https://cloud.tencent.com/document/product/1095/44871)
- Grid and speaker layouts: [宫格布局和演讲者布局使用说明](https://meeting.tencent.com/support/topic/1621/index.html)
- Member list from the bottom bar: [管理成员使用指南](https://meeting.tencent.com/support/topic/1520/)
- Screen share and the bottom toolbar: [共享屏幕使用指南](https://meeting.tencent.com/support/topic/440/index.html)
- App design spec (type, views, the color section is an image and did not yield hex in text): [应用设计规范](https://cloud.tencent.com/document/product/1095/84403)
- Product site: [meeting.tencent.com](https://meeting.tencent.com/)

Reference images:

- Client gallery, home and related screens (Yesky, public client screenshots): [腾讯会议电脑版图集](https://mydown.yesky.com/pcsoft/2147448568_image.html)
  - Home-style frame used for sampling: [689659Y6D153.png](https://image.yesky.com/uploadImages/2024/291/04/689659Y6D153.png)
  - Further frames: [6S4X168FC68X.png](https://image.yesky.com/uploadImages/2024/291/04/6S4X168FC68X.png), [A5K1V836Q0D6.png](https://image.yesky.com/uploadImages/2024/291/04/A5K1V836Q0D6.png), [6O1WSI03E148.png](https://image.yesky.com/uploadImages/2024/291/04/6O1WSI03E148.png)
- Official layout diagrams on the help page above:
  - [meeting-63a18edb648c5.png](https://cdn.meeting.tencent.com/upload/website/support-center/meeting-63a18edb648c5.png) (speaker view)
  - [meeting-63a18eef5444f.png](https://cdn.meeting.tencent.com/upload/website/support-center/meeting-63a18eef5444f.png)
  - [meeting-63a18efb47a3d.png](https://cdn.meeting.tencent.com/upload/website/support-center/meeting-63a18efb47a3d.png)
- Site logo: [logo128.png](https://cdn.meeting.tencent.com/assets/next-website/logo128.png)

## Home screen

Official copy, from the desktop quick-start:

- After login the main panel is where you start or join a meeting, and where your profile and the meeting list live.
- **加入会议**: enter a meeting number and the name you want shown, plus the pre-join mic and camera options, then join.
- **快速会议**: an instant meeting. No form. It does not appear in the meeting list.
- **预定会议**: a future meeting. You fill in topic, time, and options, then confirm. Scheduled meetings stay on the list.
- **会议列表**: upcoming scheduled meetings, with the meeting number visible. A quick meeting is not listed.
- The avatar opens account info. The personal meeting room (个人会议号) is a fixed code.

Layout read from the public client screenshot (1200×600, almost entirely a light UI, mean RGB about 249, 251, 254):

- White page. Sampled background pixel `#ffffff`.
- A narrow left rail. Sampled rail pixel `#f3f3f4`. Icon plus a short label, stacked. The current section uses the blue accent.
- The main column is not a marketing hero. It is a row of large action tiles, then the list.
- The four actions in current desktop builds are 加入会议, 快速会议, 预定会议, and 共享屏幕. Each tile is a blue circular line icon with a short label under it, sitting on the white page. There is no heavy card shadow.
- The list is rows, not cards: time, title, meeting number, and an enter action.
- Profile sits at the top of the main column (avatar and name), not a gold wordmark.

## Color and type

Sampled from the home screenshot above:

| Role | Hex | How it was read |
| --- | --- | --- |
| Page | `#ffffff` | Pixel at (400, 40) |
| Left rail | `#f3f3f4` | Pixel at (20, 200) |
| Accent | `#006fff` | Exact pixels in the action icons, including (370, 376) |

Nearby icon pixels in the same file are `#0070ff`, `#0067ff`, `#005fff`. The accent to implement is `#006fff`.

The official site logo (`logo128.png`) samples around `#0493fd`. That is the marketing mark, not the client chrome. The client icons are the deeper `#006fff`.

The design spec’s type table (text, not an image) names:

- macOS: PingFang SC, with TencentSans as the brand face
- Windows: 微软雅黑 and Arial

UI labels are small, regular weight, near-black on white. The accent is used for the active nav item, action icons, links, and the primary button. Red is reserved for ending a meeting.

## In a meeting

From the official layout article:

- Two layouts: **宫格布局** (equal tiles) and **演讲者布局** (one large speaker, small tiles beside it).
- The switch sits at the top right. Grid density can be 9, 25, or 49. With a screen share, the client defaults to speaker view.
- A tile can show the person’s video or, with the camera off, a placeholder. The name sits on the tile. The current speaker is visually distinct.
- Official diagram `meeting-63a18edb648c5.png` shows the large tile on the left and a vertical stack of smaller tiles on the right.

From the member and share articles, the bottom toolbar is a full-width bar of icon-over-label controls:

- 静音 / 解除静音
- 开启视频 / 停止视频
- 共享屏幕
- 邀请
- 成员 (opens the member list)
- 聊天
- 录制
- 更多
- **结束** on the right, in red, separate from the icon row

The member list is a side list: name, mic state, and host controls at the bottom of that list. Chat is the other drawer, with the transcript and a composer at the bottom. Captions sit over the video, not in a second page.

The in-meeting stage in the official diagrams is a dark video surface, not the white home. Those PNGs are letterboxed, so this doc does not treat a toolbar hex from them as sampled. The rebuild uses a near-black stage (`#1c1c1c`) and a slightly lighter bar (`#242424`) as a reconstruction of that dark room.

## Module plan

1. **Home.** Done in this pass. Left rail, four actions, meeting list, join dialog (number, name, mic and camera), schedule dialog, personal code.
2. **Meeting room and control bar.** Done in this pass. Dark stage, grid and speaker layouts, top bar with the meeting number and layout switch, bottom toolbar in the official order, captions over the video.
3. **Participants and chat drawers.** Started only as the panels the toolbar already opens (成员, 聊天). A later pass can add host controls, unread badges, and the real chat composer chrome.
4. **Right AI panel.** Kept in the room: plan, design, verify, research, the suggestion, the yes banner, and parked chatter. Restyled as a light side column so it can sit next to the dark stage. A later pass can match Tencent’s 375px sidebar spec more tightly.
5. **Task desk.** Not rebuilt. It stays at `/tasks`, linked from the rail as 任务.

## What this pass does not copy

Login, WeChat, the real screen-share picker, cloud recording, and the avatar account menu. 共享屏幕 and 录制 are visible controls; they do not capture the desktop.
