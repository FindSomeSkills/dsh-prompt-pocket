# 两台机器同步：实际步骤

数据在私有仓库 `FindSomeSkills/dsh-prompt-pocket-sync`，一台一条提示词一个文件。

## 已经做完的（Windows）

- `~/.dsh/dsh-prompt-stash` 里的仓库：remote、代理、credential helper 都配好
- 面板显示「同步」，每次改动 3 秒后自动提交推送；启动时合并远端

## Mac 上要做的一次性设置

```bash
# 1. 装 DSH 和插件（版本写死：pnpm 的 minimumReleaseAge 会跳过刚发布的版本）
dsh plugin --profile web add dsh-prompt-pocket@1.0.5
```

```bash
# 2. git 能推这个仓库：推荐 gh 登录一次
brew install gh
gh auth login
gh auth setup-git
```

国内网络需要代理时，给仓库单独配，不动全局：

```bash
git config --global http.https://github.com.proxy http://127.0.0.1:7897
```

然后打开面板 → 点「同步未开启」→ 填：

```
https://github.com/FindSomeSkills/dsh-prompt-pocket-sync.git
```

首次同步会拉下 Windows 这边的两条，并推送 Mac 自己的。

## 删掉的东西怎么传过去

删除不会删远端文件，而是把那个文件改写成墓碑（`{"id":…,"deletedAt":…}`）。另一台机器合并时看到墓碑就删掉本地那条。墓碑保留 90 天后清理。

## 出问题时看哪里

- 面板右下角的字：`同步失败` 时把鼠标放上去，标题里是具体错误
- 宿主日志里的 git 输出：`~/.dsh/dsh-prompt-stash/.git/logs/HEAD`
- 仓库里的文件应当只有 `store.d/*.json` 和 `.gitignore`
