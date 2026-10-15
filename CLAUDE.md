# Webinar Platform

"模拟直播"研讨会平台:预录视频(Vimeo)+ 固定场次 + 实时评论 + 人气显示。
单租户,最终交付给一家客户公司。

**本文件是唯一事实来源。** 功能变更时先改本文件,再改代码。与本文件冲突时,先停下来问,不要自行决定。

## 环境

- Windows + PowerShell + VSCode
- Node 26、pnpm 11
- PostgreSQL 本地安装,库名 `webinar_platform`,端口 5432,不用 Docker
- 数据库密码只放 `.env`,绝不提交,绝不写进文档或回复

## 技术栈

- pnpm workspace
- `apps/web`:Next.js(App Router)+ TypeScript + Tailwind + shadcn/ui
- `apps/api`:NestJS + TypeScript
- `packages/shared`:zod schema、共享类型、纯函数
- PostgreSQL + Prisma
- 视频只用 Vimeo(Player SDK + Vimeo API)
- 实时:SSE,带轮询降级
- Excel 导出:exceljs

已批准依赖:`argon2`、`@nestjs/throttler`、`next-intl`、`@vimeo/player`、`exceljs`、`libphonenumber-js`、`react-hook-form`、NestJS 的 JWT 与 cookie 相关包。
M1 批准的数据库依赖:`prisma`(devDependency)、`@prisma/client`、`@prisma/adapter-pg`,三个都锁 `^7.10.0`;`libphonenumber-js` 锁 `^1.13.15`(放 `packages/shared`)。必须显式写版本号,不要用不带版本的 `pnpm add prisma`(npm 的 `latest` 标签可能指向候选版)。
明确不装:`dotenv`、`tsx`、`@nestjs/config`、`ts-node`。
测试:`apps/api` 用 Jest,`packages/shared` 和 `apps/web` 用 Vitest。
基础工具链已批准:`typescript`(锁 6.0.x)、`eslint`、`typescript-eslint`、`eslint-config-next`、`zod`,Next/React/Tailwind v4/PostCSS,NestJS 核心包与 CLI,Jest/ts-jest/supertest/Vitest 及对应 `@types`。具体版本由各里程碑计划确定。
apps/api 若 Jest 跑不通 ESM,先停下来问,不要自行改用 Vitest。

## 目录结构

```
.
├─ apps
│  ├─ web
│  │  ├─ app
│  │  │  └─ lib
│  │  └─ scripts
│  └─ api
│     ├─ prisma
│     │  ├─ schema.prisma
│     │  ├─ migrations
│     │  └─ seed.ts
│     ├─ prisma.config.ts
│     ├─ src
│     │  └─ generated
│     │     └─ prisma          (不进 Git)
│     └─ test
├─ packages
│  └─ shared
│     └─ src
│        ├─ email.ts
│        ├─ phone.ts
│        ├─ trigger-time.ts
│        ├─ webinar-state.ts
│        ├─ current-run.ts
│        ├─ target-seconds.ts
│        ├─ hype.ts
│        ├─ identity-open.ts
│        └─ identity-whitelist.ts
├─ .env.example
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ eslint.config.mjs
```

约定:
- `apps/web/scripts/run-next.mjs`:读 `WEB_PORT`,映射成 Next 读的 `PORT`,再启动 Next
- 每个包用两个 tsconfig:`tsconfig.json` 含测试,用于 typecheck;`tsconfig.build.json` 排除测试,用于 build
- `packages/shared/src` 按文件放纯函数(见「核心纯函数」),测试与源文件同目录(`*.test.ts`)

## 常用命令(其中两条 prisma 命令要到 M1 完成后才可用,其余已可用)

```powershell
pnpm install
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## 运行与构建

- 根目录 `test`、`typecheck`、`build` 串行执行(`--workspace-concurrency=1`);`dev` 并行
- api 与 web 的 `test`、`typecheck`、`build`、`dev` 运行前,会先构建 shared(pre 脚本)
- `dev` 只在启动时构建一次 shared,之后改 shared 源码要重启
- Prisma 生成物放 `apps/api/src/generated/prisma`,加入 `.gitignore`。api 的 `predev`、`prebuild`、`pretest`、`pretypecheck` 在构建 shared 之后再运行 `prisma generate`。全新克隆里没有生成物,靠这些 pre 脚本生成
- 默认端口:api 4000(`API_PORT`),web 3000(`WEB_PORT`);`API_URL` 默认 `http://localhost:4000`
- web 的 `dev`/`start` 走 `scripts/run-next.mjs`。Windows 上它的信号转发不可靠,部署到 Linux 时(M8)再确认
- 已知问题:根目录 `pnpm dev` 会让 api 与 web 的 `predev` 同时构建 shared,两个 `tsc` 同时写入 `shared/dist`。连续 5 次实测没有出问题。若启动 `dev` 时偶发"找不到 shared"或文件被占用,重启即可;只有反复出现才处理,不要提前改脚本约定

## 环境变量

- 根目录一个 `.env`(从 `.env.example` 复制),所有 app 读它
- `DATABASE_URL` 只允许 `apps/api` 与 Prisma 使用。`apps/web` 的代码不得引用 `DATABASE_URL` 或任何密钥
- 任何密钥类变量不得以 `NEXT_PUBLIC_` 开头
- web 进程只加载白名单变量(`WEB_PORT`、`API_URL`),不得把整个 `.env` 载入 web 进程。实现方式在 M1 计划里提出,并用测试或实测证明 web 进程里读不到 `DATABASE_URL`
- 加载方式(Node 的 `--env-file`、Next 的加载、Prisma 读取位置)必须在计划里先查证,不靠猜
- `.env.example` 随代码更新,密码用占位符 `CHANGE_ME`
- 数据库密码含特殊字符(如 `@` `:` `/` `#` 空格)时,在连接字符串里要做 URL 编码
- `.env.example` 要包含 `DATABASE_URL` 和 `TEST_DATABASE_URL`,密码用占位符 `CHANGE_ME`
- 新增 `TEST_DATABASE_URL`;测试库名固定 `webinar_platform_test`。给测试库建表用 `prisma migrate deploy`,不用 `migrate reset`。绝不对开发库执行 `migrate reset`
- 测试用例和测试客户端不用 `DATABASE_URL` 连接;只有 `assertTestDatabase` 读取它的库名来比较
- 守卫函数 `assertTestDatabase`:库名必须以 `_test` 结尾且与 `DATABASE_URL` 的库名不同,否则抛错;每次建测试客户端和每次清表前都调用
- `apps/web` 下不得有 `.env` 文件;web 非测试源码里不得出现 `DATABASE_URL` 或以 `NEXT_PUBLIC_` 开头的密钥名(用守卫测试扫描)

**已定方案(以实现为准)**
- api 和 Prisma 用 Node 自带的 `process.loadEnvFile` 读根 `.env`:路径从文件自身位置推出,已存在的环境变量优先,文件缺失就忽略
- `prisma.config.ts` 直接读 `process.env.DATABASE_URL`,不用 `env()`,这样没有 `.env` 的机器也能跑 `prisma generate`
- web 用一个纯函数 `buildWebEnv` 解析根 `.env`,只挑 `WEB_PORT` 和 `API_URL` 传给 Next 子进程,不写入当前进程

---

## 已确认的业务决策

- 单租户
- 每个研讨会设置接入模式 `accessMode`:
  - `WHITELIST`:观众输入手机号**或**邮箱,在名单里且状态正常才能进
  - `OPEN`:观众填姓名+手机+邮箱直接进,自动入库并报名可报名的期(定义见「当前期的定义」)
- 白名单模式下,必须报名了某一期才能看那一期
- 手机号国家码:国家码列表(+60 默认、+65、+86)存在数据库设置表,管理员以后可自行添加。接受任何有效的国际号码(含座机);列表只决定"没写国家码时按哪国解析"
- 视频只用 Vimeo 预录
- 被踢出的人任何模式下都不能进
- 观众姓名必填
- 停用的研讨会和期,由调用方先过滤掉再交给选择函数
- OPEN 模式补报名和新建报名,只针对"可报名的期"(定义见「当前期的定义」)。没有则拒绝,提示"暂无可报名的期"(`NO_RUN`)。这和「当前期的定义」第③条(最近结束的期)不同:第③条只用于展示状态,不用于报名
- WHITELIST:有名单记录但没有报名可进入的期,与"找不到"用同一句"未找到报名记录"

### 删除策略(混合)
- 研讨会、期:有任何关联数据(报名、出勤、评论)只能停用(`isActive=false`),不能删除;没有任何关联数据才允许删除
- 场次、每天模板:只有真实评论和出勤记录阻止删除(它们没有停用开关,需要改日期或另建);预设评论由服务先删;没有则可删除
- 预设评论:可直接删除
- 实时评论:只能隐藏,不能删除
- 观众:日常用"踢出",可恢复。只有 ADMIN 能彻底删除观众,同时删除其报名、出勤记录和评论(清除个人资料)
- 所有删除操作都写入审计日志
- 数据库外键用 RESTRICT 兜底;服务在同一事务里先删"空的"子记录再删本体;预设评论由服务先删。细节在 M2 计划里定

## 核心概念(三层结构)

- **研讨会 Webinar**:一个系列的内容
- **每天模板 WebinarDay**:第几天、Vimeo 视频、当天几点开始(不含日期)
- **期 Run**:一个批次,例如"3 月班"
- **场次 RunSession**:某一期的某一天的实际日期与起止时间
- 内容只做一次,可以反复开新的期,每期只需重新选日期

## 当前期的定义

按顺序取第一个符合的:① 正在直播的期 ② 下一场最早开始的期 ③ 最近结束的期。
并列时取 Run 创建时间最早的,再并列取 id 小的。
已登录观众只在自己报名的期里按此规则取。

**可报名的期**:单个期,是第①条选出的期;没有则取第②条选出的期;第③条选出的期不可报名。OPEN 模式的报名(补报名、新建报名)只报名到这个期。可报名的期在该研讨会的全部启用的期里取,不受"已登录观众只在自己报名的期里取"那句限制;那句只适用于展示状态和 WHITELIST。
人气抖动里的"会话 ID"指 RunSession ID。

## 数据模型(要点,字段以 Prisma schema 为准)

| 表 | 关键点 |
|---|---|
| AdminUser | 邮箱、密码哈希、角色(ADMIN / OPERATOR / VIEWER) |
| Webinar | `alias` 唯一、`accessMode`(默认 `WHITELIST`)、`timezone`(默认 `Asia/Kuala_Lumpur`)、封面、启用 |
| WebinarDay | `dayNumber`、`vimeoVideoId`、`vimeoHash`、`durationSeconds`、`startTime`(HH:mm) |
| Run | `webinarId`、名称、启用、`hypeConfig`(JSON);`unique(webinarId, name)` |
| RunSession | `startsAt`、`endsAt`(timestamptz);`(runId, dayId)` 唯一 |
| Attendee | 所属研讨会(`webinarId`);姓名、手机(E.164,可空)、邮箱(小写,可空),至少一个;状态 `ACTIVE/KICKED`;来源(IMPORTED / MANUAL / SELF_REGISTERED);是否禁言。踢出只在该研讨会生效;同一人在两个研讨会是两条记录 |
| Enrollment | 谁报名了哪一期;`(attendeeId, runId)` 唯一 |
| AttendanceLog | `(attendeeId, runSessionId)` 唯一;加入、最后心跳、离开时间;观看秒数 |
| ScheduledComment | 绑定到某一天模板;作者名、内容、`triggerSeconds` |
| Comment | 实时评论;观众或主持人;可隐藏 |
| CountryCode(设置表) | 国家代码(`code`,如 MY)、区号(`dialCode`,如 +60)、名称、是否默认;用部分唯一索引保证只有一个默认 |
| AuditLog | 谁、何时、做了什么;`entityId` 是普通字符串,不加外键(被删对象的审计记录要保留) |

`hypeConfig` 的 JSON 结构:`{base, nodes:[{minute,count}], jitterPercent, jitterIntervalSeconds}`
- zod 约束:`base` 是 ≥0 整数;`nodes` 最多 100 个,`minute` ≥1 且严格递增,`count` ≥0;`jitterPercent` 0 到 100;`jitterIntervalSeconds` 1 到 300
- 默认:`base` 0、`nodes` 空、`jitterPercent` 0、`jitterIntervalSeconds` 10,即不显示虚拟人数

数据库规则:
- 主键用数据库生成的 UUID(`gen_random_uuid()`);所有时间字段显式 `timestamptz(3)`
- 表名保持 Prisma 默认大驼峰,不加 `@@map`
- 唯一约束放数据库层:`unique(webinarId, email)`、`unique(webinarId, phone)`
- CHECK 约束:
  - Attendee:手机或邮箱至少一个;邮箱必须小写;手机必须是 E.164
  - RunSession:`endsAt > startsAt`
  - WebinarDay:`dayNumber ≥ 1`;`durationSeconds > 0`;`startTime` 为 `HH:mm`
  - ScheduledComment:`triggerSeconds ≥ 0`
  - AttendanceLog:`watchedSeconds ≥ 0`;`leftAt` 不早于 `joinedAt`
  - Comment:观众评论必须有 `attendeeId`,主持人评论必须有 `adminUserId`
  - Run:`hypeConfig` 必须是 JSON 对象
  - CountryCode:`code` 是两位大写字母,`dialCode` 是 `+` 加数字
- 外键:研讨会、期、场次、每天模板的子表用 RESTRICT,不用级联;观众的报名、出勤、评论用 CASCADE(只为彻底删除观众这个场景)

种子数据:
- 参考数据(CountryCode 三行)总是执行
- 演示数据只在带 `--demo` 时执行,`NODE_ENV=production` 时拒绝运行;用写死的固定 UUID 按 id upsert,可重复运行
- 管理员账号不在 M1 种子里,留到 M2

## 功能清单

### 观众端
- 落地页 `/w/[alias]`:封面、简介、状态徽章、倒计时、按接入模式显示表单
- 两种接入模式(见上),成功后签发会话令牌(httpOnly Cookie);再次访问可"欢迎回来"一键进入
- 场次状态:未开始(倒计时)/ 直播中 / 两天之间(下一天倒计时)/ 全部结束
- 直播观看:迟到者从当前进度开始;静音自动播放,点击取消静音
- 防暂停、防拖动、屏蔽右键(只是劝阻,不是安全措施)
- 评论区:预设评论按视频时间弹出;观众发言;主持人官方回复
- 虚拟在线人数
- 手机端全屏沉浸式布局;桌面端视频 3/4 + 评论 1/4
- 被踢出后立即送回落地页
- 出勤:30 秒心跳,离开时用 `sendBeacon` 记录

### 管理后台
- 管理员登录、角色权限
- 研讨会管理:标题、别名、简介、封面、启用、接入模式、时区
- 每天模板:Vimeo 视频下拉搜索;结束时间由视频时长自动算
- 期与场次管理;人气引擎设置
- 报名名单:增删改查、搜索、踢出/恢复;Excel/CSV 批量导入(先预览再提交);模板下载;导出
- 预设评论:增删改、批量导入、清空某一天
- 控制室:选 研讨会→期→场次;在线/离线名单;实时评论;以主持人回复;隐藏评论;禁言
- 数据分析:出勤、观看时长、评论日志;可按"天"筛选;Excel 导出
- 国家码设置:管理员可添加、设置默认
- 操作审计日志

## 身份匹配规则

**WHITELIST**
1. 输入含 `@` 视为邮箱,否则视为手机号;分别规范化
2. 在该研讨会的名单里精确查找
3. 找不到 → 统一提示"未找到报名记录",不透露哪个字段不匹配
4. 已被踢出 → 提示"访问已被撤销,请联系主办方"
5. 必须有该场次所属期的报名记录

**OPEN**
执行顺序:规范化 → 按邮箱和手机查找 A、B → 检查被踢出(匹配到的任何人已被踢出则 `KICKED` 拒绝,不做任何写入)→ 确定可报名的期(没有则 `NO_RUN` 拒绝,不做任何写入)→ 只有通过这两步检查,才可以补全手机或邮箱、补报名、或新建。`KICKED` 优先于 `NO_RUN`。

1. 规范化手机和邮箱
2. 按邮箱找到 A,按手机找到 B
3. A、B 都存在且不是同一人 → 其中任何一人已被踢出则拒绝;都没被踢出则以 A(邮箱)为准,不改任何字段,记警告日志
4. 只找到其中一个 → 沿用;对方缺手机或邮箱且新值没被占用,则补全
5. 已存在但没报名可报名的期的人,自动补报名可报名的期并放行
6. 都找不到 → 新建(来源=SELF_REGISTERED);有可报名的期则报名,没有则拒绝(`NO_RUN`),并且不创建该观众
7. 已存在的人不覆盖姓名
8. 匹配到的任何人已被踢出,一律拒绝,提示"访问已被撤销,请联系主办方"

没有可报名的期时,已存在的人同样返回 `NO_RUN` 拒绝,不做任何写入。有可报名的期时:已报名该期则正常放行;报名的是别的期,则补报名可报名的那一期。

OPEN 模式下身份未经验证,这是产品取舍,不是 bug。

## 核心纯函数

- 全部放 `packages/shared`,先写测试再写实现,不访问数据库
- `resolveIdentity`(OPEN):调用方先规范化并查出 A、B 及其已报名的期,连同"可报名的期"一起传入。返回 `rejected`(类型里没有 `writes` 字段)或 `proceed`(`writes` 只有 `createAttendee`、`fillPhone`、`fillEmail`、`enroll` 四种数据,函数自己不执行任何东西)。函数按顺序执行:先检查 A、B 是否有人被踢出,有则返回 `rejected`(`KICKED`);再检查有没有可报名的期,没有则返回 `rejected`(`NO_RUN`);`KICKED` 优先于 `NO_RUN`。只有两步都通过才计算 `writes`,所以类型层面不可能带写入。写入里永远不含改姓名。`rejected` 的原因有 `KICKED` 和 `NO_RUN`。没有可报名的期时,无论是新观众还是已存在的人,都返回 `rejected`(`NO_RUN`),不做任何写入(新观众也不创建)。有可报名的期时:已存在的人已报名该期则放行;报名的是别的期,则 `writes` 里带 `enroll` 报名可报名的那一期
  - 测试用例要求补充三条:
    - 已报名可报名的期,不产生 `enroll`
    - 只报名了别的期,而可报名的期是另一个,则 `writes` 带 `enroll`(原有报名不动)
    - 同时被踢出且没有可报名的期时,返回 `KICKED` 而不是 `NO_RUN`
- `resolveWhitelistAccess`:返回 `allowed` 或 `denied`(`NOT_FOUND`、`KICKED`、`NOT_ENROLLED`,其中 `NOT_FOUND` 与 `NOT_ENROLLED` 对外同一句话)。输入含 `@` 视为邮箱,否则视为手机号
- `getWebinarState`:同一时刻有两场都在直播时,取 `startsAt` 早的,再取 id 小的
- `normalizePhone`:默认国家作为参数传入(ISO 国家码,来源是 CountryCode 表里 `isDefault` 的那一行),要求 `isValid()` 才返回 E.164,否则 `null`;使用 `libphonenumber-js` 的 `max` 元数据。测试用例的期望值必须先用真实库跑出来再固定,不要凭记忆写
- `seededJitter`:只用整数运算,保证浏览器和服务器结果一致

## 直播同步规则

### 场次状态(纯函数 `getWebinarState`)
- `live`:存在 `startsAt <= now < endsAt` 的场次
- 否则 `upcoming`:存在 `startsAt > now`,取最早的;没有已结束场次=第一场之前,否则=两天之间
- 否则 `ended`:存在已结束场次
- 否则 `no_schedule`
- 边界 `now === startsAt`、`now === endsAt` 必须有测试

### 时钟与目标位置
- 一律以服务器时间为准;进入时采样 3 次,取偏移中位数,每 5 分钟重新采样
- `targetSeconds = clamp((serverNow - startsAt) / 1000, 0, durationSeconds)`
- 迟到者加载完成后,在 `loaded` 回调**内部**现算目标位置再 seek(不要提前算)

### 常量
| 名称 | 值 |
|---|---|
| 心跳间隔 | 30 秒,进入时立即发一次 |
| 在线判定 | 最近心跳在 90 秒内 |
| 僵尸会话 | 120 秒无心跳且无离开记录 → 时长按最后心跳封顶 |
| 切回前台校准阈值 | 偏差 > 5 秒,先等 800 毫秒 |
| 后台兜底校准 | 每 15 秒,偏差 > 10 秒 |
| 跳转判定 | 视频时间突变 > 5 秒 |
| 评论 DOM 上限 | 200 条 |
| 人气追赶 | 每 1 秒,步长随机 1~3 |

### Vimeo 播放器注意事项
- 选项:`autoplay: true, muted: true, controls: false, keyboard: false, speed: false`;容器固定 16:9
- Unlisted 视频需要隐私哈希。由服务端保存时解析 `vimeoVideoId` 和 `vimeoHash`;`url` 参数只能出现一次
- 不要同时用 `responsive: true` 和自定义容器
- 播放器初始化不要依赖会短暂变成 `loading` 的状态;后台刷新数据不得重建播放器
- `play()` 要 `.catch(noop)`;"播放器就绪"状态放在 try/catch 外面设置
- 切回前台后,等 800 毫秒再调用 SDK;SDK 调用包一层带超时的函数;校准期间用互斥锁

### 评论引擎
- 预设评论按 `triggerSeconds` 排序,用指针推进,每次 timeupdate 只处理新到的,一次性更新列表
- 向后跳转时用二分查找重置指针
- 预设评论按时间窗口分段向服务器取(提前约 2 分钟),不要一次全发给浏览器
- 进入或跳转后,先**一次性**补齐历史评论(无动画),补齐完成前不允许指针引擎和实时推送写入列表
- 以评论 ID 去重;任何写入都保留最后 200 条
- 预设评论与真实观众评论样式统一;主持人回复用官方样式

### 人气引擎
- 显示人数 = 虚拟部分 + 真实在线人数
- 虚拟曲线:`[{minute:0, count:base}, ...nodes]` 按分钟排序;节点之间线性插值;超过最后节点取最后值;结果取整
- 抖动:每 N 秒重算目标 `round(曲线值 × (1 − p% + 随机 × 2p%))`;随机数由"会话 ID + 时间片"决定,同一时间片所有观众目标相同
- 追赶:显示值每秒向目标靠近 1~3
- 跳转(> 5 秒)时直接对齐,不要从 0 爬升
- 服务端数据到达前不渲染

### 出勤统计
- `join` 幂等(同人同场次一条记录)
- 服务端校验观看秒数不超过 `now - joinedAt`
- 完成度 = `min(观看秒数, 视频时长) / 视频时长`,**在后端计算**
- 同一人多设备在线只算一人

### 被踢出
- 管理员踢人 → SSE 推送 → 前端清 Cookie 并回落地页
- 服务端**每个请求**都校验状态为正常

## 安全规则

- 观众接口必须校验会话令牌,不信任浏览器传来的用户 ID
- 管理接口必须校验角色
- 接入、评论、心跳、登录都要限流
- 预设评论不得一次性暴露未来内容
- 管理员密码用 argon2;登录失败多次要锁定

---

## 路线图(一次只做一个里程碑)

| 里程碑 | 内容 |
|---|---|
| M0 | 项目骨架:workspace、Next.js、NestJS、shared、`/health`、`/time`(已完成并验收) |
| M1 | 数据库:Prisma schema、迁移、种子数据;核心纯函数 + 测试 |
| M2 | API 核心:管理员登录与权限、研讨会/天/期/场次 CRUD、Vimeo 服务 |
| M3 | 管理后台界面 |
| M4 | 观众接入与场次状态、落地页 |
| M5 | 观看页:5a 播放器与同步、5b 评论、5c 人气引擎 |
| M6 | SSE 实时与控制室 |
| M7 | 数据分析与导出 |
| M8 | 交付:部署、测试、安全检查、文档 |

调整:
- API 与界面随各里程碑一起做,不集中在 M2。M2 只做登录/权限/研讨会/天/期/场次/Vimeo;报名名单、导入、预设评论、国家码设置随 M3 做;观众接入随 M4 做;出勤接口随 M5a 做
- M4、M5 的评论与踢出先用轮询(踢出:每次请求校验 + 10 秒轮询),M6 再换成 SSE

M1 分段(每段只做一件事,每段结束 lint、typecheck、test、build 全绿):
- S1 环境变量 → S2 规范化与时间解析 → S3 场次与期 → S4 人气 → S5 身份匹配 → S6 Prisma 与迁移 → S7 数据库测试 → S8 种子
- M1 完成后的整体验收,必须从全新克隆再跑一遍

完成一个里程碑才进下一个。每个里程碑开始前,先出计划,等我确认再改代码。

## 安装与依赖

- pnpm 若因发布冷却期拒装,退到上一个兼容版本,不要关闭该设置
- 依赖构建脚本只逐个批准必要的包,不用 --all
- 不用 nest new、create-next-app 等生成器,手写文件
- M0 不装 shadcn/ui 和 next-intl,M3 起再接
- ESLint 10 与 eslint-config-next 16 有 peer 警告,已知且接受。不降级 ESLint,不加 `peerDependencyRules`,让警告保持可见。升级相关包时重新检查,M3 之前复核一次
- `next.config.ts` 里 `agentRules: false`,不要创建 `AGENTS.md`;`next-env.d.ts` 不进 Git
- 版本写法统一用 `^`(typescript 用 `~6.0.x`),锁文件版本不能被改动

## 待定(到对应里程碑再问,问之前不要自行决定)

- 角色权限矩阵
- 限流与锁定的数值
- 会话令牌有效期、Cookie 与部署(含 Next 与 Nest 跨域)
- 导入模板的列、导入到哪一期
- 评论补齐是否包含真实观众评论、真实评论的视频时间位置
- 预设评论提前下发的窗口大小
- 观看秒数的来源、多设备合并、`joinedAt` 取首次还是最近一次
- 手机号输入界面(国家码下拉,还是输入 +65)
- 场次与模板联动(改模板是否重算已建场次)
- 品牌配色、默认界面语言
- 管理员是否需要两步验证
- 是否保留虚拟人数与预设评论的总开关
- web 取数没有超时设置,M3 之前处理
- `layout.tsx` 缺 `<html lang>`,等默认界面语言定了再补
- 演示用的真实 Vimeo 视频 ID(M5a 之前提供,之前用占位值)
- 新功能想法

---

## 硬性规则

1. **先计划后动手。** 开始前只出计划,等确认再改代码
2. **一次只做一件事。** 不顺手做计划之外的功能
3. **每个提交可构建、测试通过**
4. **时间:** 数据库 `timestamptz`;API 传 ISO 8601 UTC;按 `webinar.timezone` 展示;直播状态以服务器时间为准
5. **校验:** 入参用 `packages/shared` 的 zod schema,前后端共用
6. **手机号与邮箱:** 手机号 E.164,邮箱小写。规范化函数放 `packages/shared`,用 `libphonenumber-js`,默认国家作为参数传入,必须有单元测试
7. **测试:** 纯函数先写测试再写实现;身份匹配、场次状态、权限必须有集成测试。M1 做纯函数的完整单元测试;身份匹配与场次状态的集成测试放在 M4
8. **依赖:** 只用技术栈里列出的"已批准依赖",其余新依赖先说明理由,等我确认
9. **密钥:** 只放 `.env`;保持 `.env.example` 同步
10. **文案:** 界面文字走 i18n 字典(zh/en),不硬编码
11. **范围:** 不做多租户、不做现场直播、不做视频托管、不做支付

## Skills 分工

### 回复风格:caveman
- **只用于聊天回复**,简短汇报结果
- **不用于:** 代码、注释、提交信息、本文件
- 回复语言:中文

### 写代码:ponytail
- 代码风格用 ponytail
- ponytail 只管代码风格;测试要求以硬性规则 7 为准
- 与本文件冲突时,先停下来问,不要自行取舍

### 开发流程:superpowers
| 步骤 | Skill |
|---|---|
| 需求不清楚时 | `superpowers:brainstorming` |
| 开始前出计划 | `superpowers:writing-plans` |
| 确认后执行 | `superpowers:executing-plans` |
| 写核心逻辑 | `superpowers:test-driven-development` |
| 出 bug | `superpowers:systematic-debugging` |
| 宣布完成之前 | `superpowers:verification-before-completion` |
| 完成后审查 | `code-review` |
| 准备合并 | `superpowers:finishing-a-development-branch` |

- 计划只在聊天里出,不写 `docs/` 等任何文件;不自动提交,我明确说了才提交

### 前端设计
- 新页面或新组件:先用 `frontend-design:frontend-design` 定风格并实现
- 统一配色、字体、图表:按需用 `ui-ux-pro-max`,不是每次都用
- 页面写完:用 `web-design-guidelines` 做无障碍与规范审查
- 按顺序分步使用,不并行:`ui-ux-pro-max`(定配色字体,一次)→ `frontend-design`(实现)→ `web-design-guidelines`(审查)
- 观看页的布局规则以本文件为准,设计 Skill 只管视觉

### 按里程碑额外使用
| 里程碑 | Skill |
|---|---|
| M0 | `nextjs`、`nestjs-best-practices` |
| M1 | `prisma-client-api` |
| M2 | `nestjs-best-practices`、`prisma-client-api`、`security-review` |
| M3 | `nextjs`、`vercel-react-best-practices`、`frontend-design:frontend-design`、`ui-ux-pro-max`(一次,定统一配色与字体)、`web-design-guidelines`(完成后检查)。后台保持简洁 |
| M4 | `nextjs`、`nestjs-best-practices`、`security-review`、`frontend-design:frontend-design`(落地页)、`web-design-guidelines`(完成后检查) |
| M5 | `vercel-react-best-practices`、`run`、`frontend-design:frontend-design`(只管视觉,不改布局规则)、`web-design-guidelines`(完成后检查) |
| M6 | `nestjs-best-practices` |
| M7 | `prisma-client-api`、`ui-ux-pro-max`(图表类型与配色) |
| M8 | `playwright-best-practices`、`security-review`、`ruflo-security-audit:dependency-check`、`ruflo-security-audit:security-scan`、`simplify` |

### 不要用
`init`(会覆盖本文件)、`planning-with-files` 系列、`caveman-commit`、`caveman-review`、`stripe-best-practices`、`claude-api`。

## 提交规范

`feat(api): ...` / `fix(web): ...` / `docs: ...` / `test: ...` / `chore: ...`
提交信息用正常句子,不用 caveman 风格。