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
- `apps/web/scripts` 下有 `build-web-env.mjs`(纯函数 `buildWebEnv`,含测试);`run-next.mjs` 启动前会读取根 `.env` 并调用它
- `apps/api/src/load-env.ts` 负责加载根 `.env`,`main.ts` 的第一个导入就是它
- `apps/api` 的测试放在 `apps/api/test/`,不放 `src/`(`tsconfig.build.json` 只含 `src` 且不带 jest 类型,放 `src` 会被编进构建)
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
- Jest 给每个测试文件一份 `process.env` 的副本,而 `process.loadEnvFile` 写的是真实环境;要测"读写环境变量"的代码,在普通 Node 子进程里测
- `load-env.ts` 导入时就会执行加载。因此 S7 的数据库测试必须显式使用 `TEST_DATABASE_URL` 建立连接,不能靠这个导入副作用
- 已知问题:根目录 `pnpm dev` 会让 api 与 web 的 `predev` 同时构建 shared,两个 `tsc` 同时写入 `shared/dist`。连续 5 次实测没有出问题。若启动 `dev` 时偶发"找不到 shared"或文件被占用,重启即可;只有反复出现才处理,不要提前改脚本约定
- 已知问题:`pnpm --filter web build` 直接运行 `next build`,不读根 `.env`。首页是动态路由,每次请求才读 `API_URL`,所以构建不需要它。如果以后出现构建期预渲染且依赖 `API_URL` 的页面,再让 `build` 也走启动器

## 环境变量

- 根目录一个 `.env`(从 `.env.example` 复制),所有 app 读它
- `DATABASE_URL` 只允许 `apps/api` 与 Prisma 使用。`apps/web` 的代码不得读取或使用 `DATABASE_URL` 的值,也不得读取或使用任何密钥(`apps/web/scripts` 里的 `buildWebEnv` 只写出这个名字用于剔除,见下文)
- 任何密钥类变量不得以 `NEXT_PUBLIC_` 开头
- web 进程只加载白名单变量(`WEB_PORT`、`API_URL`),不得把整个 `.env` 载入 web 进程;由 `buildWebEnv` 的单元测试和守卫测试保证(见下方「已实现(S1)」)
- 读取环境变量的方式(Next 的加载、Prisma 读取位置)必须在计划里先查证,不靠猜
- `.env.example` 随代码更新,包含 `DATABASE_URL` 和 `TEST_DATABASE_URL`,密码用占位符 `CHANGE_ME`
- 数据库密码含特殊字符(如 `@` `:` `/` `#` 空格)时,在连接字符串里要做 URL 编码
- `TEST_DATABASE_URL` 指向测试库,库名固定 `webinar_platform_test`。给测试库建表用 `prisma migrate deploy`,不用 `migrate reset`。绝不对开发库执行 `migrate reset`
- 测试用例和测试客户端不用 `DATABASE_URL` 连接;只有 `assertTestDatabase` 读取它的库名来比较
- 守卫函数 `assertTestDatabase`:库名必须以 `_test` 结尾且与 `DATABASE_URL` 的库名不同,否则抛错;每次建测试客户端和每次清表前都调用
- `apps/web` 下不得有 `.env` 文件;`apps/web/app` 下的非测试源码不得出现 `DATABASE_URL` 或 `NEXT_PUBLIC_`(用守卫测试扫描);`apps/web/scripts` 里的 `buildWebEnv` 为了剔除它必须写出 `DATABASE_URL` 这个名字,所以 `scripts/` 不在守卫范围内,但也不得读取或使用它的值

**已实现(S1)**
- api 用 Node 自带的 `process.loadEnvFile` 读根 `.env`(`apps/api/src/load-env.ts`):路径从文件自身位置推出(`src/` 和 `dist/` 下都是 `../../../.env`),已存在的环境变量优先,只有文件不存在才忽略,其他错误照常抛出
- web 用纯函数 `buildWebEnv` 解析根 `.env`(用 `util.parseEnv`,只解析,不写入当前进程),结果传给 Next 子进程。规则:
  - 白名单变量是 `WEB_PORT`、`API_URL`;系统环境变量优先于 `.env`
  - 子进程环境 = 当前进程环境 + 白名单变量,再剔除"根 `.env` 里出现的所有非白名单键"和 `DATABASE_URL`、`TEST_DATABASE_URL`(无论是否出现在 `.env`)
  - 变量名比较不区分大小写
- web 要新增环境变量时,必须先加进白名单并更新本节
- 守卫测试只扫描 `apps/web/app` 下的非测试源码;`scripts/` 不扫(`buildWebEnv` 必须写出 `DATABASE_URL` 这个名字)

**待实现(S6)**
- Prisma 读根 `.env` 的方式与 api 相同(`process.loadEnvFile`);`prisma.config.ts` 直接读 `process.env.DATABASE_URL`,不用 `env()`,这样没有 `.env` 的机器也能跑 `prisma generate`

---

## 已确认的业务决策

- 单租户
- 每个研讨会设置接入模式 `accessMode`:
  - `WHITELIST`:观众输入手机号**或**邮箱,在名单里且状态正常才能进
  - `OPEN`:观众填姓名+手机+邮箱直接进,自动入库并报名可报名的期(定义见「当前期的定义」)
- 白名单模式下,必须报名了某一期才能看那一期
- 手机号国家码:国家码列表(+60 默认、+65、+86)存在数据库设置表,管理员以后可自行添加。手机号用 `parsePhone` 规范化;`ready` 和 `review` 都可以用来匹配名单(`invalid` 不行);管理员导入或手动添加时,`review` 号码需要明确确认才入库;列表只决定"没写国家码时按哪国解析"
- 视频只用 Vimeo 预录
- 被踢出的人任何模式下都不能进
- 观众姓名必填
- 停用的研讨会和期,由调用方先过滤掉再交给选择函数
- OPEN 模式补报名和新建报名,只针对"可报名的期"(定义见「当前期的定义」)。没有则拒绝,提示"暂无可报名的期"(`NO_RUN`)。这和「当前期的定义」第③条(最近结束的期)不同:第③条只用于展示状态,不用于报名
- WHITELIST:有名单记录但没有报名任何有场次的期,与"找不到"用同一句"未找到报名记录"

### 删除策略(混合)
- 研讨会、期:有任何关联数据(报名、出勤、评论)只能停用(`isActive=false`),不能删除;没有任何关联数据才允许删除
- 场次、每天模板:只有真实评论和出勤记录阻止删除(它们没有停用开关,需要改日期或另建);预设评论由服务先删;没有则可删除
- 预设评论:可直接删除
- 实时评论:只能隐藏,不能删除
- 观众:日常用"踢出",可恢复。只有 ADMIN 能彻底删除观众,同时删除其报名、出勤记录和评论(清除个人资料)
- 所有删除操作都写入审计日志
- 数据库外键用 RESTRICT 兜底;服务在同一事务里先删"空的"子记录再删本体。细节在 M2 计划里定

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
- zod 约束:`base` 是 0 到 1000000 的整数;`nodes` 最多 100 个,`minute` 是 1 到 1440 的整数且严格递增,`count` 是 0 到 1000000 的整数;`jitterPercent` 是 0 到 100 的整数;`jitterIntervalSeconds` 是 1 到 300 的整数。拒绝未知字段(顶层和节点里都是);`{}` 合法,解析后得到完整默认值(这也是数据库的默认值)
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
- 演示场次的 `startsAt`、`endsAt` 每次运行带 `--demo` 的种子时,都按"现在"重新定位(例如第一天已开始 5 分钟、仍在直播,第二天在明天同一时刻),并更新已有的行,不新增行。这样隔天重新运行种子,演示数据仍然是"直播中"。这个行为在 M1.5 验收时依赖,S8 必须实现并有测试
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
5. 必须报名了至少一个有场次的期;进入的是他报名的期里的当前期(按「当前期的定义」选出),该期已结束也放行(页面显示"系列已结束")。如果他一个有场次的期都没报名,按"未找到报名记录"处理(对外与找不到同一句话)

**OPEN**
执行顺序:规范化 → 按邮箱和手机查找 A、B → 检查被踢出(匹配到的任何人已被踢出则 `KICKED` 拒绝,不做任何写入)→ 确定可报名的期(没有则 `NO_RUN` 拒绝,不做任何写入)→ 只有通过这两步检查,才可以补全手机或邮箱、补报名、或新建。`KICKED` 优先于 `NO_RUN`。

1. 规范化手机和邮箱
2. 按邮箱找到 A,按手机找到 B
3. A、B 都存在且不是同一人 → 其中任何一人已被踢出则拒绝;都没被踢出则以 A(邮箱)为准,不改任何字段,记警告日志
4. 只找到其中一个 → 沿用;找到的那个人缺手机或邮箱,且新值没被别人占用,则补全
5. 已存在但没报名可报名的期的人,自动补报名可报名的期并放行
6. 都找不到 → 新建(来源=SELF_REGISTERED);有可报名的期则报名,没有则拒绝(`NO_RUN`),并且不创建该观众
7. 已存在的人不覆盖姓名
8. 匹配到的任何人已被踢出,一律拒绝,提示"访问已被撤销,请联系主办方"

没有可报名的期时,已存在的人同样返回 `NO_RUN` 拒绝,不做任何写入。有可报名的期时:已报名该期则正常放行;报名的是别的期,则补报名可报名的那一期。

OPEN 模式下身份未经验证,这是产品取舍,不是 bug。

## 名单导入规则(M3 实现)

- 手机号只用一列(不拆区号);可选一列 Country Code。有该列且号码没写 `+` 时,用该行的国家;否则用本次导入选的默认国家。管理员不需要手动拆分区号。其他列(姓名、邮箱等)见「待定」里的"导入模板的列"
- 预览页每行显示:原始内容、整理后的号码、国家、状态、原因;分 Ready、Review、Invalid 三类
- Review 行不得批量确认,只能逐行确认或逐行改国家;Invalid 行必须修正或跳过;改国家后立刻重新解析
- 对 `NOT_VALID_RANGE` 的行,试 CountryCode 表里的其他国家;如果恰好只有一个国家判为有效,给出建议(例如"看起来像马来西亚号码 +60160809580,要改成 MY 吗?")
- 手机号单元格里出现多个号码(含 `/` `,` `;` `、` 等分隔符)时,提示"请拆成多行"
- 重复检测在预览里完成:文件内部重复,以及与该研讨会已有名单重复
- Excel 数字格式的坑:手机列可能是数字类型,开头的 0 会丢,大数字会显示成科学计数法。读取时按原始值转成不带指数的字符串;导入模板的手机列设成文本格式。丢了 0 的号码交给默认国家解析
- 管理员手动添加或编辑观众的手机号,同样使用 `parsePhone`;`review` 要明确确认
- 观众端:国家下拉(默认马来西亚)加手机输入框;输入以 `+` 开头时国际格式优先,与下拉无关
- 观众端的国家下拉列出 CountryCode 表里的所有国家;管理员要移除某个国家就从表里删除

## 核心纯函数

- 全部放 `packages/shared`,先写测试再写实现,不访问数据库
- `resolveIdentity(input, lookup, enrollableRunId)`(OPEN):`input` 是 `{ name, phone, email }`,调用方已规范化(`phone` 是 E.164,`email` 是小写);`lookup` 是 `{ byEmail(即 A), byPhone(即 B) }`,各为 `null` 或 `KnownPerson { id, phone, email, status, enrolledRunIds }`;`enrollableRunId` 是 `selectEnrollableRun` 的结果。返回 `rejected`(`reason`: `KICKED` | `NO_RUN`;类型里没有 `writes` 字段,运行时也没有这个键)或 `proceed { attendee, runId, writes, warnings }`。`attendee` 是 `AttendeeRef`:`{ kind: 'existing', attendeeId }` 或 `{ kind: 'new' }`。`Write` 只有四种数据:`createAttendee`(`name`、`phone`、`email`、`source: SELF_REGISTERED`)、`fillPhone`(`attendeeId`、`phone`)、`fillEmail`(`attendeeId`、`email`)、`enroll`(`runId`、`attendee: AttendeeRef`);函数自己不执行任何东西。`Warning` 只有 `EMAIL_PHONE_CONFLICT`(带两个人的 id)。写入顺序:新观众是 `[createAttendee, enroll]`;已存在的人是 `[fillPhone 或 fillEmail(有的话), enroll(需要的话)]`。`runId` 就是 `enrollableRunId`
  - 测试用例要求补充三条:
    - 已报名可报名的期,不产生 `enroll`
    - 只报名了别的期,而可报名的期是另一个,则 `writes` 带 `enroll`(原有报名不动)
    - 同时被踢出且没有可报名的期时,返回 `KICKED` 而不是 `NO_RUN`
- `resolveIdentity` 的执行顺序(不得重排):① 校验输入,不合法抛 `RangeError`(先于一切,所以被踢出的人加上坏输入也是抛错,不是 `KICKED`);② 匹配到的任何人已被踢出 → `rejected`/`KICKED`;③ `enrollableRunId` 为 `null` → `rejected`/`NO_RUN`(新观众不创建,已存在的人不写入);④ 才计算写入。`KICKED` 优先于 `NO_RUN`
- `resolveIdentity` 的写入规则:A、B 都为 `null` → `[createAttendee, enroll]`;A、B 是同一个人 → 当作一个人,无警告;A、B 是不同的人 → 用 A,不补全任何字段,带 `EMAIL_PHONE_CONFLICT` 警告;只有 A 且 A 没有手机 → `fillPhone`;只有 B 且 B 没有邮箱 → `fillEmail`;已有不同的手机或邮箱则不改;被使用的人没报名 `enrollableRunId` 才加 `enroll`(已报名则不加,原有的其他报名不动);已存在的人的姓名永远不被修改,`createAttendee` 只在 A、B 都为 `null` 时出现
- `resolveIdentity` 的输入校验(`RangeError`):`name` 去空格后为空;`phone` 不匹配 `E164_CHECK`;`email` 为空或不是小写;`byEmail` 不为 `null` 但它的 `email` 不等于 `input.email`;`byPhone` 不为 `null` 但它的 `phone` 不等于 `input.phone`
- `parseWhitelistInput(raw, defaultCountry)`:只做分类和规范化,不查库。含 ASCII `@` 才视为邮箱(用 `normalizeEmail`,得到 `null` 则 `invalid`;含 `@` 的输入永远不会被当成手机号);否则视为手机号(用 `parsePhone`,`ready` 和 `review` 都得到 `phone`,`invalid` 得到 `invalid`)。全角 `＠` 不算 `@`。返回 `{ kind: 'email', email }` | `{ kind: 'phone', phone }` | `{ kind: 'invalid' }`
- `resolveWhitelistAccess(match, now)`:`match` 是 `null` 或 `{ id, status, enrolledRuns }`;`enrolledRuns` 是调用方已过滤掉停用的期的、该人报名的期。顺序:先校验 `now`(无效或不是 `Date` 一律抛 `RangeError`,即使 `match` 为 `null` 或被踢出);`match` 为 `null` → `denied`/`NOT_FOUND`;`status` 为 `KICKED` → `denied`/`KICKED`(优先于 `NOT_ENROLLED`);否则在他报名的期里用 `selectCurrentRun` 选当前期,选不出(报名的期都没有场次,或没有报名)→ `denied`/`NOT_ENROLLED`;选出了就 `allowed`,返回 `{ attendeeId, runId, phase: live | upcoming | ended }`。报名的期已结束仍然放行(`phase` 为 `ended`,页面显示"系列已结束"),避免老学员在系列结束后回来看到"未找到报名记录"
- `publicReason(reason)`:对外返回的原因。`NOT_FOUND` 和 `NOT_ENROLLED` 都映射成 `NOT_FOUND`(不透露是哪个条件不满足);`KICKED` → `REVOKED`;`NO_RUN` → `NO_RUN`。用 `switch` 保证穷尽。对外接口只能返回 `publicReason` 的结果,不得返回内部原因
- `E164_CHECK`(`^\+[1-9][0-9]{6,14}$`)是 TypeScript 源码里数据库 CHECK 规则的唯一实现,在 `phone.ts` 里导出,`parsePhone` 和 `resolveIdentity` 共用。迁移里的 SQL CHECK 是数据库端的另一份,两者必须一致,S7 的数据库测试要验证这一点;测试里手写的独立副本是有意保留的,用来独立检查代码输出
- 导出:`parseWhitelistInput`、`resolveWhitelistAccess`、`publicReason`、`resolveIdentity`、`E164_CHECK` 及相关类型(`KnownPerson`、`OpenInput`、`OpenLookup`、`AttendeeRef`、`OpenWrite`、`OpenWarning`、`OpenResolution`、`WhitelistMatch`、`WhitelistAccess`、`PublicReason` 等)。`instant` 和 `range` 是包内辅助函数,不导出
- `getWebinarState(sessions, now)`:输入是场次数组(`{id, startsAt, endsAt}`)和 `now`,顺序任意;返回判别联合 `live`(`session`)/ `upcoming`(`phase`: `before_first` | `between_days`,`next`)/ `ended`(`lastEnded`)/ `no_schedule`。规则不变:`live` 同时有多场时取 `startsAt` 最早,再取 id 小的;`upcoming` 取 `startsAt` 最早,再取 id 小的;`before_first` 指没有任何已结束场次;`ended` 的 `lastEnded` 取 `endsAt` 最晚,再取 id 小的。返回的 `session` 是传入的对象本身,不是副本
- `selectCurrentRun(runs, now)`:输入的 run 是 `{id, createdAt, sessions[]}`,调用方已过滤停用的期和(登录观众)未报名的期;返回 `{ runId, phase: live | upcoming | ended }` 或 `null`。按「当前期的定义」①②③:② 里每个期用自己"最早的未来场次"的开始时间比较;③ 里用每个期"最大的 `endsAt`"比较,最晚的优先;同一阶段内并列取 `createdAt` 最早,再取 id 小的。有已结束又有未开始场次的期算 `upcoming`。没有场次的期被忽略(但仍校验它的 `createdAt`)
- `selectEnrollableRun(runs, now)`:返回 `string | null`;当前期的阶段是 `live` 或 `upcoming` 时返回 `runId`,`ended` 或没有当前期返回 `null`(即「可报名的期」)
- `computeTargetSeconds(serverNowMs, startsAtMs, durationSeconds)`:返回 `clamp((serverNowMs - startsAtMs) / 1000, 0, durationSeconds)`,不取整
- 以上函数(`getWebinarState`、`selectCurrentRun`、`selectEnrollableRun`、`computeTargetSeconds`)共同的规则:都是纯函数,时间一律从参数传入,不得调用 `Date.now()`、无参 `new Date()`、读环境变量或访问数据库,也不得修改传入的参数;无效输入(无效或不是 `Date` 的值、`endsAt` 不晚于 `startsAt`、非有限数、负的时长)一律抛 `RangeError`,并且检查所有输入,包括不影响本次结果的坏数据;id 的比较用 UTF-16 代码单元顺序(`a < b`),不得用 `localeCompare`(它随语言环境变化,浏览器和服务器可能得出不同结果)
- 导出的类型:`SessionWindow`、`WebinarState`、`RunWindow`、`RunPhase`。内部辅助函数 `instant` 和 `range` 不对外导出
- `parsePhone(raw, defaultCountry)` 返回 `{ status: ready | review | invalid, e164, country, reasons }`。`normalizePhone(raw, defaultCountry, allowedCountries?)` 基于它:`ready` 和 `review` 返回 `e164`,`invalid` 返回 `null`;`allowedCountries` 不传则不限制国家
  - 默认国家作为参数传入(ISO 国家码,默认取 CountryCode 表里 `isDefault` 的那一行;导入和观众端可另选国家,见「名单导入规则」)。使用 `libphonenumber-js` 的 `max` 元数据。测试用例的期望值必须先用真实库跑出来再固定,不要凭记忆写
  - 手机号在数据库里只存一列 E.164(`Attendee.phone`)。界面上分开显示区号和号码,用库从 E.164 拆出,不存两份
  - 观众输入和名单里的号码用同一个函数各自规范化后比较,匹配就进入;管理员在预览里确认过的 review 号码,观众也一定能匹配上
  - 先清洗再交给库:NFKC 之后,删除所有 Cf 字符(零宽、方向标记、BOM),所有 Unicode 空白换成普通空格,所有 Unicode 破折号和减号换成 `-`
  - 状态与原因代码:
    - `invalid`(`e164` 为 `null`,只有一个原因):`CONTAINS_LETTERS`(含英文字母,含分机)、`UNPARSEABLE`、`NOT_POSSIBLE`、`E164_OUT_OF_RANGE`(不匹配数据库 CHECK)、`E164_NOT_STABLE`(结果再解析一次会变)
    - `review`(`e164` 不为 `null`,原因可并存):`NOT_VALID_RANGE`(长度合理但号段无效)、`LOOKS_LIKE_INCLUDES_COUNTRY_CODE`(无 `+` 或 `00` 前缀,数字串等于结果去掉 `+` 之后的数字串)、`UNEXPECTED_CHARACTERS`(清洗后仍有数字、空格、`+ - ( ) .` 以外的字符,而库仍解析成功)
    - `ready`:有效,且没有以上 `review` 原因
  - `defaultCountry` 不是库认识的国家码时不抛异常:本地格式得到 `invalid`(`UNPARSEABLE`),国际格式照常解析。所以"添加国家码"的功能(M3)必须在保存时校验该国家码被库支持
- `normalizeEmail`:去首尾空格并转小写;只接受可打印 ASCII 字符(含控制字符一律拒绝);必须恰好一个 `@`;本地部分和域名都不能为空;域名必须含点;本地部分和域名都不能以点开头或结尾、不能有连续两个点;总长不超过 254;保留 `+` 后缀和 Gmail 的点
- `parseTriggerSeconds`:支持纯秒数、数字、`mm:ss`、`h:mm:ss`,全角冒号等同半角;两段时分钟可超过 59,三段时分钟必须小于 60;冒号格式里秒必须小于 60;小数一律四舍五入;拒绝负数、`NaN`、`Infinity`、含字母(含 `1e3`、`0x10`)、带正负号、空段、超过 `maxSeconds`(取整之后比较)、`Date` 对象
- `hypeConfigSchema`(zod,含默认值)、`defaultHypeConfig`(冻结)、类型 `HypeConfig`
- `computeHypeBase(config, elapsedSeconds)`:`elapsedSeconds` 小于 0 当作 0,不是有限数抛 `RangeError`;节点的 `minute` 不严格递增或数值不是有限数抛 `RangeError`;结果是非负整数
- `seededJitter(sessionId, slice, curveValue, jitterPercent)`:返回 `Math.round(curveValue × (1 − p/100 + r × 2p/100))`;`jitterPercent` 为 0 时恰好等于 `Math.round(curveValue)`;`curveValue` 不是有限非负数、`jitterPercent` 不在 0 到 100,抛 `RangeError`
- `computeHypeTarget`:`realOnline` 必须是非负整数,`elapsedSeconds` 必须是有限数(包括不能是 `-Infinity`),否则抛 `RangeError`
- 对外导出:`hypeConfigSchema`、`defaultHypeConfig`、`HypeConfig`、`computeHypeBase`、`computeHypeTarget`、`seededJitter`;`seededRandom` 不导出
- 注:`seededRandom` 用 `%` 和 `/` 把 `slice` 拆成低、高 32 位,`slice` 必须是非负安全整数,在这个范围内两者都是精确的

### 库的已知行为(以实验为准)
- 库会把一些违反数据库 CHECK 的号码判为有效(德国 16 位或 6 位、伊朗 6 位、尼日利亚 16 位),所以 `isValid` 之后必须再做 CHECK 检查
- 以 `00` 开头的某些输入,库每次解析会多去掉一个 `0`,结果不稳定(如 `00016821879`),因此有 `E164_NOT_STABLE`
- 库会忽略号码尾巴上的汉字和多余字符,分号分隔的两个号码只读第一个,所以要靠 `UNEXPECTED_CHARACTERS` 提醒;用 `/` 或 `,` 分隔的两个号码拼起来超长,库直接拒绝
- 同一个马来西亚号码的五种写法(`0160809580`、`160809580`、`016-080 9580`、`+60160809580`、`60160809580`)得到同一个 E.164
- 选错默认国家时(例如把马来西亚号码按新加坡解析),得到的是"长度合理但无效"的另一个号码,状态是 `review`(`NOT_VALID_RANGE`),S2 不猜测,M3 的导入预览要给出建议
- 已知误判:美国国内写法 `1-202-555-0123` 会被判为 `review`(`LOOKS_LIKE_INCLUDES_COUNTRY_CODE`),可以接受

### 已知风险
- `instant()` 用 `instanceof Date` 判断,在 Jest 沙箱里,来自另一个运行环境的 `Date` 可能被误判为无效。如果 S7 的数据库测试里出现"not a valid date",改成跨环境的判断(例如 `Object.prototype.toString.call(x) === "[object Date]"`),并用 `vm.runInNewContext` 造一个跨环境的 `Date` 写回归测试。在出现之前不要改。S5 的 `resolveWhitelistAccess` 也会调用它

## 调用方的职责(M4 实现时必须遵守)

- 服务负责:规范化输入;在该研讨会内按邮箱查 A、按手机查 B;读出他们已报名的期;在该研讨会所有启用的期里用 `selectEnrollableRun` 算出可报名的期;再调用纯函数
- 纯函数返回 `proceed` 后,服务把 `writes` 在同一个数据库事务里按顺序执行(`createAttendee` 之后,`enroll` 用新建的观众 id);任何一步失败整体回滚
- 并发:两个请求同时用同一个邮箱或手机自助注册时,`createAttendee` 可能撞上数据库的唯一约束。服务必须捕获该错误,重新查找 A、B 并再调用一次 `resolveIdentity`,不得把唯一约束错误直接返回给观众,也不得创建重复的人
- 警告(`EMAIL_PHONE_CONFLICT`)写入日志
- 对观众返回的拒绝原因只能用 `publicReason` 的结果
- 服务必须有集成测试覆盖:被踢出的人在任何路径下数据库里没有任何新增或修改;并发注册不产生重复的人

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
- 虚拟曲线:`[{minute:0, count:base}, ...nodes]` 按分钟排序;节点之间线性插值;超过最后节点取最后值;结果取整。曲线值取整用四舍五入(一半向上);节点的秒数 = `minute × 60`;经过节点时值恰好等于该节点的 `count`
- 抖动:每 N 秒重算目标 `round(曲线值 × (1 − p% + 随机 × 2p%))`;随机数由"会话 ID + 时间片"决定,同一时间片所有观众目标相同。曲线值取时间片开头那一刻(`slice × jitterIntervalSeconds`),不是观众当前的时刻。所以同一个时间片内,所有观众、所有时刻的目标完全相同,在任何配置下都成立(包括有斜率的曲线,也包括 `jitterPercent` 为 0)
- 追赶:显示值每秒向目标靠近 1~3
- 跳转(> 5 秒)时直接对齐,不要从 0 爬升
- 服务端数据到达前不渲染
- 浏览器和服务器必须调用同一个 `computeHypeTarget(config, sessionId, elapsedSeconds, realOnline)`,不得各自重写时间片的计算。它返回 虚拟部分 + `realOnline`;`sessionId` 指 RunSession ID;`elapsedSeconds` 小于 0 当作 0
- 随机数算法 `seededRandom`(FNV-1a 作用于 `sessionId` 的每个 UTF-16 代码单元,再用 murmur3 的 `fmix32` 混入 `slice` 的低 32 位和高 32 位,最后除以 2^32)只在 shared 内部使用,不对外导出。它的输出被单元测试里的快照和校验和锁死。改动这个算法会改变所有观众看到的数字,必须是有意的变更:先在本文件记录原因,再同时更新快照
- 人气引擎的计算只用 + − × ÷、`Math.round` 和整数运算(`Math.imul`、`>>>`、`^`),不得用 `Math.random`、`Date`、`Math.sin`、`Math.pow` 等,以保证各个环境结果一致。M5c 要在真实浏览器里对比验证(方式见「待定」)。这条只适用于 `packages/shared` 里的目标值计算(要在浏览器和服务器得出同一个数的部分)。追赶步长只影响单个观众自己屏幕上的显示,可以用随机数,但随机数必须通过参数注入(而不是在函数里直接调用 `Math.random`),测试里注入固定种子的伪随机数,以满足硬性规则 13
- "只用整数运算"只对 `seededRandom` 成立(`Math.imul`、`>>>`、`^`、`+`;拆 `slice` 另用 `%` 和 `/`,见「核心纯函数」的注);计算目标值的其余部分(曲线插值、抖动、`computeHypeTarget`)用 + − × ÷ 和 `Math.round`,这些都是各个 JavaScript 环境结果一致的运算

**已知观察点(M5c)**
- 曲线每 N 秒阶梯式变化,抖动幅度大时目标一跳可能较大,而显示值每秒只向目标靠近 1~3,所以显示值会持续追赶、略有滞后,这是有意的(数字变化平滑)。M5c 在真实页面里观察,如果观感不好再调整

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
| M1.5 | 可见切片:用演示数据端到端看到"数据库 → API → 网页"(M1 验收之后做) |
| M2 | API 核心:管理员登录与权限、研讨会/天/期/场次 CRUD、Vimeo 服务 |
| M3 | 管理后台界面 |
| M4 | 观众接入(WHITELIST / OPEN)、会话令牌、接入后的入口与提示;落地页的状态徽章和倒计时在 M1.5 已做 |
| M5 | 观看页:5a 播放器与同步、5b 评论、5c 人气引擎 |
| M6 | SSE 实时与控制室 |
| M7 | 数据分析与导出 |
| M8 | 交付:部署、测试、安全检查、文档 |

调整:
- API 与界面随各里程碑一起做,不集中在 M2。M2 只做登录/权限/研讨会/天/期/场次/Vimeo;报名名单、导入、预设评论、国家码设置随 M3 做;观众接入随 M4 做;出勤接口随 M5a 做
- M4、M5 的评论与踢出先用轮询(踢出:每次请求校验 + 10 秒轮询),M6 再换成 SSE

M1 分段(每段只做一件事,每段结束 lint、typecheck、test、build 全绿):
- S1 环境变量(已完成) → S2 规范化与时间解析(已完成) → S3 场次与期(已完成) → S4 人气(已完成) → S5 身份匹配(已完成) → S6 Prisma 与迁移 → S7 数据库测试 → S8 种子
- M1 完成后的整体验收,必须从全新克隆再跑一遍

完成一个里程碑才进下一个。每个里程碑开始前,先出计划,等我确认再改代码。

### M1.5 可见切片
- 目的:尽早让产品负责人在浏览器里看到真实运行的效果,并端到端验证地基(数据库、API、纯函数、网页)。它是 M4 的一小部分提前做,不取代 M4,M4 时在它的基础上扩展,不推倒重来
- API:一个公开的只读接口,按研讨会别名返回:标题、简介、接入模式、状态(用 `getWebinarState`,当前期用 `selectCurrentRun`)、相关场次的开始和结束时间、`serverTime`。不返回任何观众数据,不返回内部编号。加基础限流(`@nestjs/throttler`,已批准)。别名不存在返回 404
- 网页:落地页 `/w/[alias]`,显示标题、简介、状态徽章(未开始 / 直播中 / 两天之间 / 已结束)和倒计时。倒计时以接口返回的 `serverTime` 校准,不用浏览器本地时钟判断状态。数据来自种子的演示数据(`demo-whitelist`、`demo-open`)
- 状态:除了四种,还要处理"暂无排期"(没有可用的期或场次时显示,不崩溃)
- 取期:匿名落地页在该研讨会所有启用的期里用 `selectCurrentRun` 选出一个,再用该期的场次调用 `getWebinarState`
- 文案:界面文字走一个最简单的字典文件(zh、en 两份,不装 next-intl),组件里不写死文字,通过查词函数取字;键名分层命名,值是纯文本,方便 M3 原样搬进 next-intl。zh 与 en 的键必须一致,用一个测试保证。临时默认语言 zh,"默认界面语言"仍在「待定」里,M3 前定;`layout.tsx` 的 `<html lang>` 在 M1.5 随这个临时默认设置
- 不做:登录或接入表单、观看页、管理后台
- 视觉:M1.5 用 `frontend-design` 做轻量、可替换的样式:颜色和字体集中在 `globals.css` 的一处主题变量里,M3 用 `ui-ux-pro-max` 定正式配色字体时只改这一处;M1.5 不运行 `ui-ux-pro-max`;不做动效和复杂布局;完成后用 `web-design-guidelines` 检查无障碍(状态徽章、倒计时的读屏与对比度)
- 测试:公开状态接口要有集成测试(使用 S7 的测试库):别名不存在返回 404;`live`、`upcoming`(`before_first` 和 `between_days`)、`ended`、暂无排期各一个用例;响应里不含内部编号和观众数据
- 验收:`pnpm dev` 之后,浏览器打开 `/w/demo-whitelist` 能看到标题、状态和倒计时;改变演示场次的时间后,状态随之变化;不存在的别名显示"找不到"页面而不是崩溃。没有管理后台时,用 DBeaver 修改演示场次的 `startsAt`、`endsAt` 来验证状态变化;重新运行带 `--demo` 的种子会把演示场次时间重新定位到"现在"附近
- 使用的 Skills:`nextjs`、`nestjs-best-practices`、`prisma-client-api`、`frontend-design:frontend-design`、`web-design-guidelines`(完成后检查);`security-review` 用来检查这个公开接口

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
- 场次与模板联动(改模板是否重算已建场次)
- 品牌配色、默认界面语言
- 管理员是否需要两步验证
- 是否保留虚拟人数与预设评论的总开关
- web 取数没有超时设置,M3 之前处理
- M1.5 先按临时默认语言设置 `<html lang>`,最终语言在"默认界面语言"定了之后再核对
- 演示用的真实 Vimeo 视频 ID(M5a 之前提供,之前用占位值)
- M5c 的真实浏览器对比验证方式。Playwright 不在已批准依赖里,M5 的 Skills 里也没有 `playwright-best-practices`(它只在 M8)。M5c 的计划里二选一:单独申请批准 Playwright(并把 `playwright-best-practices` 加进 M5 的 Skills),或者用环境里的浏览器工具做一次性验证。问之前不要自行决定
- OPEN 模式观众自助注册遇到 `review` 号码怎么办(M4 前定)。倾向(尚未决定):`ready` 和 `review` 都接受并按 E.164 入库(OPEN 不设门槛,手机号不用来证明身份),`invalid` 拒绝并提示重填;管理员名单里对 `NOT_VALID_RANGE` 的号码用 `parsePhone` 即时显示"号段无效"标记,不新增数据库字段
- CountryCode 的删除规则(M3 做国家码设置时定)。倾向(尚未决定):不允许删除当前默认国家,必须先把默认改到另一个国家;不允许删除最后一个国家。原因:没有默认国家时,本地格式的号码全部会变成 `invalid`,观众下拉和导入预览也没有默认值
- 新功能想法

---

## 硬性规则

1. **先计划后动手。** 开始前只出计划,等确认再改代码
2. **一次只做一件事。** 不顺手做计划之外的功能
3. **每个提交可构建、测试通过**
4. **时间:** 数据库 `timestamptz`;API 传 ISO 8601 UTC;按 `webinar.timezone` 展示;直播状态以服务器时间为准
5. **校验:** 入参用 `packages/shared` 的 zod schema,前后端共用
6. **手机号与邮箱:** 手机号 E.164,邮箱小写。规范化函数放 `packages/shared`,用 `libphonenumber-js`,默认国家作为参数传入,必须有单元测试
7. **测试:** 纯函数先写测试再写实现;身份匹配、场次状态、权限必须有集成测试。M1 做纯函数的完整单元测试;场次状态的集成测试在 M1.5(公开状态接口)做,身份匹配的集成测试放在 M4
8. **依赖:** 只用技术栈里列出的"已批准依赖",其余新依赖先说明理由,等我确认
9. **密钥:** 只放 `.env`;保持 `.env.example` 同步
10. **文案:** 界面文字走 i18n 字典(zh/en),不硬编码。M1.5 用「M1.5 可见切片」里的字典文件满足本规则,M3 起迁移到 next-intl
11. **范围:** 不做多租户、不做现场直播、不做视频托管、不做支付
12. **隐形字符:** 源码和测试里不得出现隐形字符。需要写零宽字符、不换行空格、方向标记等,必须用 `\uXXXX` 转义,不要让编辑工具把转义变成真实字符;提交前检查
13. **随机测试:** 测试里的随机输入必须用固定种子的伪随机数生成器,固定迭代次数,不用 `Math.random`
14. **纯函数不读取系统时间:** 需要"现在"的函数,把 `now` 作为参数传入;测试用假计时器,并把系统时间设成与测试数据毫无关系的时刻,证明结果不依赖系统时间

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
- 按顺序分步使用,不并行:`ui-ux-pro-max`(定配色字体,一次)→ `frontend-design`(实现)→ `web-design-guidelines`(审查)。例外:M1.5 只有一个页面,跳过 `ui-ux-pro-max`,配色字体集中在一处,留到 M3 统一
- 观看页的布局规则以本文件为准,设计 Skill 只管视觉

### 按里程碑额外使用
| 里程碑 | Skill |
|---|---|
| M0 | `nextjs`、`nestjs-best-practices` |
| M1 | `prisma-client-api` |
| M1.5 | `nextjs`、`nestjs-best-practices`、`prisma-client-api`、`frontend-design:frontend-design`、`web-design-guidelines`(完成后检查)、`security-review`(公开接口) |
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