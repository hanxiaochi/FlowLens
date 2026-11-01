# FlowLens 1.1：第一轮推广

这轮先找到 5 位手里有真实业务表格的人，观察他们是否能完成一份单据的流转。目标是验证用途，不是追求一次性的浏览量。下面的数字是计划目标，不是已有用户成绩。

## 先找谁

1. 工程、质量、行政等岗位的业务负责人：已经用 Word 表格和群消息办理事项。
2. 信息化实施人员、产品经理和 FDE：需要与客户确认字段、角色、退回规则。
3. 想用 AI 做内部工具的人：能说清业务，但还不理解页面、流程与数据的关系。

第一周优先第一类和第二类；“所有人都能开发产品”是长期愿景，不适合作为第一轮试用的唯一卖点。

## 七天安排

| 时间 | 行动 | 观察什么 |
| --- | --- | --- |
| 第 1 天 | 发出 1.1 Release，完善首页与在线入口 | 陌生人能否看懂它做什么 |
| 第 2–3 天 | 向 5 位熟悉的业务/实施人员一对一展示脱敏样例 | 是否有一张他们愿意拿来试的表 |
| 第 4 天 | 旁观 3 次试用，不先替对方操作 | 导入、字段确认、提交、角色切换分别卡在哪里 |
| 第 5 天 | 修复最常见的一个阻碍 | 同一人重试能否自行完成 |
| 第 6 天 | 选一个允许自荐的相关社区，按社区规则发完整案例 | 收到多少有业务背景的反馈 |
| 第 7 天 | 整理反馈，决定下一批模板与流程能力 | 是否至少有 2 人愿意再次使用 |

GitHub 的访问量与 Star 可以参考，但首要指标是完成流程的人数、卡住的位置和愿不愿意带第二张表回来。当前未植入追踪脚本；可结合自愿反馈与仓库自身统计，不能据此宣称掌握实际活跃人数。

## 中文发布稿

**标题：我做了个工具，让 Word 业务表格先在网页里跑一遍流程**

做管理系统时，经常先画一张很漂亮的流程图，但业务人员真正拿在手里的，是一堆已经用了很多年的 Word 表格。

我在做的 FlowLens，想从这些表开始：导入 DOCX，保留表格结构，确认哪些地方由谁填写，再把同一份记录提交、退回、修改、审核和签收。旁边还能看到这份业务走到了哪一步。

这次放出了一个不用注册、不用 API Key 的在线 demo，内置一份虚构工程检查表。打开就能提交，切换专业监理填写意见，再交给资料员签收。也可以去交互实验室看一个按钮如何经过规则判断、改变数据，以及服务部署在哪里。

试用：https://hanxiaochi.github.io/FlowLens/

源码：https://github.com/hanxiaochi/FlowLens

目前是本地流程推演：数据存在浏览器里，公开版不调用 AI，没有多人协作或正式电子签章。复杂 Word 的图片和排版也还需要核对。它还不能替代生产管理系统。

我更想听一个具体反馈：你手里哪张表最难搬到系统里？如果试用卡住了，欢迎在仓库反馈，描述用途和步骤就行，别上传未脱敏的客户资料。

## English post

**Title: FlowLens: turn existing Word forms into a workflow you can try**

Many internal tools begin with a stack of Word forms. FlowLens lets you import DOCX, map fields to workflow stages, and move the same record through submission, return, review, receipt, and archive.

The public demo needs no account or API key. It includes a fictional inspection form, plus an interaction lab that explains how actions change data and a 3D deployment view. The interface is currently in Chinese; an English README and a narrated 1.0 walkthrough are available.

Try it: https://hanxiaochi.github.io/FlowLens/

Code: https://github.com/hanxiaochi/FlowLens

This is a browser-local prototype, not a production workflow platform. AI generation is disabled in the public demo. There is no authenticated multiuser access or electronic signature service, and complex Word layouts need review.

I am looking for feedback from people who turn existing paperwork into internal software: which form or handoff is hardest to model? Please share anonymized examples only.

## 60 秒演示顺序

0–10 秒：展示原表和填写区，说明“业务已经在表里”。

10–30 秒：点击提交，切换专业监理，退回并写明原因；修改后重新提交。

30–45 秒：填写监理意见，交资料员签收，展示同一记录的历史。

45–60 秒：切到交互实验室/部署场景，展示“按钮后面的系统”；最后给出在线链接和反馈入口。

发布前核对平台自荐规则，避免同一稿件批量铺站。未经同意不要展示客户资料或用客户名称背书。还没有明确开源许可证，因此目前称“公开源码”，不宣传为已经采用某种开源许可证。
