/**
 * dsh-powerup — Client half.
 *
 * Power-Up is the home for small, opt-in upgrades to the Harness UI. The first
 * upgrade is a context menu in the built-in Trajectory ledger:
 *
 *   - right-click a record row to copy its text, copy a Markdown quote, quote
 *     it into the composer, open its inspector, fork the session at that
 *     record, or copy the session id;
 *   - right-click the empty ledger area for session-level actions (fork the
 *     latest completed turn, export the trajectory snapshot, open this page).
 *
 * Implementation notes:
 *   - The ledger belongs to `@deepseek-ai/dsh-client-ui-trajectory`. We do not
 *     import its modules; we observe its own `data-*` contracts and read the
 *     session-scoped `useTrajectory` hook from a tiny header utility.
 *   - `shell.overlay` owns the menu and the toast. It is root-scoped, so a
 *     hidden `conversation.session.header.utilities` bridge publishes the
 *     active session id, trajectory snapshot and composer actions into a
 *     module-level store.
 *   - Every surface uses `--dsw-alias-*` theme tokens, so light and dark themes
 *     are inherited from the host. Literal colors exist only inside the brand
 *     SVG artwork.
 *   - The whole file is wrapped in an IIFE: client bundles are concatenated
 *     into one classic-script realm and top-level bindings would collide.
 */
(() => {
  const MODULE_ID = '@restregular/dsh-powerup';

  /** Whether the host facade already holds a factory for this module id. */
  function alreadyRegistered() {
    const factories = window.__ModuleLoader__?.factories;
    return factories !== undefined && typeof factories.has === 'function' && factories.has(MODULE_ID);
  }

  if (alreadyRegistered()) return;

  window.__ModuleLoader__.load({
    id: MODULE_ID,
    factory: (require) => {
      const React = require('react');
      const h = React.createElement;
      const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;
      // react-dom is a seed module in the host's ModuleLoader (the built-in
      // Client packages require it too). Fall back to in-place rendering when
      // it is missing, so an older host loses layering but keeps working.
      const createPortal = (() => {
        try {
          const dom = require('react-dom');
          return dom !== null && dom !== undefined && typeof dom.createPortal === 'function' ? dom.createPortal : null;
        } catch {
          return null;
        }
      })();

      /**
       * Render a floating panel at the document root. Slot containers own
       * stacking contexts (`position:fixed; z-index:…`), so a high z-index
       * inside a slot still loses to a body-level popover such as the jobs menu.
       * Portaling escapes that context; without react-dom the node stays in
       * place rather than failing.
       * @param {object} node
       * @returns {object}
       */
      function renderInBody(node) {
        const body = typeof document === 'undefined' || document === null ? null : document.body;
        return createPortal !== null && body !== null ? createPortal(node, body) : node;
      }

      const NS = 'dsh-powerup';
      const SETTINGS_KEY = 'dsh-powerup:settings:v1';
      const VERSION = '0.8.1';
      const MENU_GAP = 8;
      const MENU_WIDTH = 248;
      /** Reference scheme understood by the Host's `powerup_step_read` tool. */
      const STEP_REF_PREFIX = 'dsh-step:';
      /** How long a one-click update's completion panel stays open when nothing restarts. */
      const ONE_CLICK_AUTO_CLOSE_MS = 4000;

      // ------------------------------------------------------------------
      // Dictionaries
      // ------------------------------------------------------------------
      const DICT = {
        zh: {
          'panel.title': 'Power-Up',
          'page.title': 'Power-Up',
          'page.subtitle': '给 DeepSeek Harness 加一点助推。',
          'page.featureTitle': '轨迹右键菜单',
          'page.featureDesc': '在轨迹页面右键任意记录，快速复制、引用、查看详情、复制步骤引用，或从该记录 Fork 出一个新会话。',
          'page.enabled': '已启用',
          'page.disabled': '已停用',
          'page.actions': '可用操作',
          'page.howTitle': '怎么用',
          'page.how1': '打开任意会话，切到顶部的「轨迹」视图。',
          'page.how2': '在记录行上右键；在空白处右键可执行会话级操作。',
          'page.how3': '菜单支持 ↑ / ↓ 选择、Enter 执行、Esc 关闭。',
          'page.updateTitle': '插件安装',
          'page.updateDesc': '在插件页为每个第三方已安装插件提供安装入口：从安装源读取版本，按输入框中的版本卸载旧版并按「添加插件」流程安装，完成后可立即启用并选择是否重启 DSH；也可以一键安装。',
          'page.updateHow': '打开侧边栏的「插件」页，在「已安装插件」分组中点击卡片右侧的安装图标；在面板里输入或选择版本后点「一键安装」即可，并按下面的默认行为处理。',
          'page.oneClickTitle': '一键安装',
          'page.oneClickDesc': '在安装面板里点「一键安装」时，直接安装输入框中的版本，跳过「是否启用」和「是否重启」的询问。',
          'page.oneClickEnable': '自动启用新版本',
          'page.oneClickEnableHint': '关闭后，一键安装只安装版本，保持停用，也不自动重启。',
          'page.oneClickRestart': '自动重启 DSH',
          'page.oneClickRestartHint': '关闭后，安装完成的提示会自动关闭。',
          'page.jobStopTitle': '后台任务停止原因',
          'page.jobStopDesc': '在会话顶部的后台任务面板里点停止按钮时，可以顺手填写停止原因；原因会附加在任务结束后注入会话的提示里。',
          'page.jobStopHow': '打开任意会话，点顶部的「后台任务」面板，在运行中的任务右侧点停止，填写原因（可留空）后确认。',
          'page.launcherTitle': '侧边栏启动器',
          'page.launcherDesc': '把左侧边栏的面板按钮变成自适应图标网格：列数跟着侧边栏宽度走，图标在上、文字在下；拖动图标可以排序，把一个图标拖到另一个图标的中间就会合成一个分组（像 Windows 开始菜单的文件夹），点分组会以浮层弹出里面的图标。',
          'page.launcherToggle': '启用图标网格',
          'page.launcherToggleHint': '关闭后侧边栏恢复宿主原本的列表样式；排序与分组仍会保留。',
          'launcher.groupDefault': '分组',
          'launcher.count': '{count} 个面板',
          'launcher.renameHint': '点击重命名',
          'launcher.dissolve': '解散分组',
          'launcher.removeItem': '移出分组',
          'page.footer': 'Power-Up {version} · 设置在浏览器本地保存',
          'page.localOnly': '仅影响当前浏览器',
          'action.copy': '复制内容',
          'action.copyHint': '复制这一条记录的完整文本',
          'action.quote': '复制为引用',
          'action.quoteHint': '生成可直接粘贴的 Markdown 引用',
          'action.insert': '在输入框引用',
          'action.insertHint': '把引用插入当前会话的输入框',
          'action.inspect': '查看记录详情',
          'action.inspectHint': '打开宿主自带的记录检查器',
          'action.fork': '从此处 Fork 会话',
          'action.forkHint': '带着这条记录及其之前的内容分支',
          'action.stepRef': '复制步骤引用',
          'action.stepRefHint': '复制「会话 ID + 步骤 ID」，Agent 用 powerup_step_read 即可取回该步骤的完整数据',
          'action.export': '导出轨迹 JSON',
          'action.exportHint': '把当前轨迹快照保存为 JSON 文件',
          'action.session': '复制会话 ID',
          'action.sessionHint': '方便在日志、issue 里引用',
          'action.panel': '打开 Power-Up 页面',
          'action.panelHint': '回到这个功能控制台',
          'menu.title': 'Power-Up',
          'menu.record': '轨迹记录',
          'menu.copy': '复制内容',
          'menu.quote': '复制为引用',
          'menu.insert': '在输入框引用',
          'menu.inspect': '查看记录详情',
          'menu.fork': '从此处 Fork 会话',
          'menu.forkHint': '含此条',
          'menu.stepRef': '复制步骤引用',
          'menu.noStepRef': '这条记录没有可引用的步骤 ID',
          'menu.export': '导出轨迹 JSON',
          'menu.session': '复制会话 ID',
          'menu.panel': '打开 Power-Up 页面',
          'menu.noFork': '这条记录没有可用的 Fork 位置',
          'menu.blank': '会话操作',
          'toast.copied': '已复制',
          'toast.copyFailed': '复制失败',
          'toast.inserted': '已插入输入框',
          'toast.insertFallback': '输入框不可用，已复制到剪贴板',
          'toast.forked': '已 Fork 会话',
          'toast.forkFailed': 'Fork 失败：{message}',
          'toast.exported': '轨迹已导出',
          'toast.exportFailed': '导出失败：{message}',
          'toast.empty': '这条记录没有可复制的文本',
          'toast.actionFailed': '操作失败：{message}',
          'toast.sessionCopied': '会话 ID 已复制',
          'toast.stepRefCopied': '步骤引用已复制',
          'toast.forkUnavailable': '当前宿主没有提供 Fork 接口',
          'toast.noSession': '还没有打开会话',
          'jobStop.title': '停止后台任务',
          'jobStop.subtitle': '停止后无法恢复，正在运行的工作会中断。',
          'jobStop.close': '关闭',
          'jobStop.reasonLabel': '停止原因（可选）',
          'jobStop.reasonPlaceholder': '例如：已经不需要这个结果了',
          'jobStop.reasonNote': '原因会附加在任务结束后注入会话的提示里。',
          'jobStop.cancel': '取消',
          'jobStop.confirm': '停止任务',
          'jobStop.stopping': '正在停止…',
          'jobStop.failed': '停止失败：{message}',
          'update.button': '安装',
          'update.title': '安装插件',
          'update.subtitle': '按输入框中的版本安装；已安装的副本会先移除。',
          'update.current': '当前版本',
          'update.versionLabel': '版本号',
          'update.versionPlaceholder': '输入版本号，或从列表选择',
          'update.loadingVersions': '正在从安装源读取版本…',
          'update.loading': '正在读取插件和版本列表…',
          'update.chooseVersion': '选择版本',
          'update.hideVersions': '收起列表',
          'update.versionsCount': '共 {count} 个版本',
          'update.versionsFailed': '读取版本失败：{message}',
          'update.versionsEmpty': '安装源没有返回可用版本',
          'update.latest': '最新',
          'update.currentTag': '当前',
          'update.currentAndLatest': '当前 · 最新',
          'update.retry': '重试',
          'update.registry': '安装源',
          'update.registryDefault': '默认安装源',
          'update.registryMirror': '中国大陆镜像源',
          'update.registryCustom': '自定义地址',
          'update.registryFrom': '版本列表来自 {registry}',
          'update.start': '开始安装',
          'update.cancel': '取消',
          'update.close': '关闭',
          'update.step.checking': '正在校验版本…',
          'update.step.removing': '正在卸载旧版…',
          'update.step.installing': '正在安装 {version}…',
          'update.step.rollback': '正在恢复旧版本 {version}…',
          'update.step.enabling': '正在启用…',
          'update.log': '安装输出',
          'update.enableTitle': '安装完成，是否立即启用？',
          'update.enableDesc': '启用后新版本才会加载。',
          'update.enableNow': '立即启用',
          'update.enableLater': '稍后启用',
          'update.enableFailed': '启用失败：{message}',
          'update.restartTitle': '是否立即重启 DSH？',
          'update.restartDesc': '重启会关闭并重新打开 DSH，正在运行的任务会中断。',
          'update.restartNow': '立即重启',
          'update.restartLater': '稍后重启',
          'update.restartUnsupported': '当前运行方式无法自动重启：{reason}',
          'update.restarting': 'DSH 正在重启，窗口即将关闭…',
          'update.restartFailed': '重启请求失败：{message}',
          'update.selfUpdateWarning': '安装 Power-Up 会在后台卸载并安装所选版本；本面板会关闭，完成后刷新页面。',
          'update.selfUpdating': 'Power-Up 正在后台安装…',
          'update.selfRefresh': '完成后请刷新页面。',
          'update.setDefault': '设为默认',
          'update.defaultTag': '默认',
          'update.defaultHint': '安装列表默认使用此安装源',
          'restart.tag': '需重启',
          'restart.tagHint': '该插件已安装新版本，重启 DSH 后生效',
          'restart.pending': '{count} 个插件待重启',
          'restart.none': '暂无插件需要重启',
          'restart.action': '重启 DSH',
          'restart.title': '重启 DSH？',
          'restart.desc': '重启会关闭并重新打开 DSH，正在运行的任务会中断。',
          'restart.cancel': '取消',
          'restart.confirm': '立即重启',
          'update.doneTitle': '安装完成',
          'update.doneInstalled': '{name} 已安装 {version}。',
          'update.doneDisabled': '{name} 已安装 {version}，尚未启用。',
          'update.doneEnabled': '新版本已启用。',
          'update.doneRestart': '部分更改需要重启 DSH 后生效。',
          'update.doneAutoClose': '完成面板将在 {seconds} 秒后自动关闭。',
          'update.doneButton': '完成',
          'update.oneClick': '一键安装',
          'update.oneClickTitle': '一键安装',
          'update.oneClickHint': '安装输入框中的版本 {version}，跳过「是否启用」和「是否重启」的询问。',
          'update.oneClickDefaults': '自动启用：{enable} · 自动重启：{restart}。可在侧边栏 Power-Up 页面修改。',
          'update.on': '开',
          'update.off': '关',
          'update.oneClickNoVersion': '请先输入或选择要安装的版本。',
          'update.oneClickEnableFailed': '新版本已安装，但自动启用失败。请到「插件」页手动启用。',
          'update.oneClickSkippedEnable': '已按设置保持停用；需要时到「插件」页启用。',
          'update.errorTitle': '安装失败',
          'update.rollbackOkTitle': '已恢复旧版本',
          'update.rollbackOkDesc': '安装失败，{name} 已自动回滚到 {version}，仍可继续使用。',
          'update.rollbackFailedTitle': '旧版本恢复失败',
          'update.rollbackFailedDesc': '自动回滚失败：{message}。请到「插件」页用「添加插件」重新安装。',
          'update.rollbackUnavailable': '无法确定旧版本号，未能自动回滚。请到「插件」页重新安装。',
          'update.selfTitle': '请用「添加插件」安装 Power-Up 自身',
          'update.selfDesc': '安装 Power-Up 会先卸载本插件，安装流程会随之中断。',
          'update.notRemovable': '该插件受 DSH 管理，不能在这里安装。',
          'update.notBundle': '该包不是 DSH 插件包。',
          'update.alreadyInstalled': '该包已安装，请先卸载旧版本。',
          'update.notFound': '安装源里找不到这个版本。',
          'update.cancelled': '安装已取消。',
          'update.installedChip': '未安装',
          'update.unknown': '未知错误',
          'update.invalidVersion': '请输入有效版本号（例如 1.2.3）',
          'update.stopProfile': '当前 profile 不能热卸载该插件，请重启 DSH 后再试。',
          'update.unsupportedTitle': '无法自动安装',
        },
        en: {
          'panel.title': 'Power-Up',
          'page.title': 'Power-Up',
          'page.subtitle': 'A little boost for DeepSeek Harness.',
          'page.featureTitle': 'Trajectory context menu',
          'page.featureDesc': 'Right-click any trajectory record to copy it, quote it, open its inspector, copy a step reference, or fork the session at that point.',
          'page.enabled': 'Enabled',
          'page.disabled': 'Disabled',
          'page.actions': 'What you can do',
          'page.howTitle': 'How to use it',
          'page.how1': 'Open a session and switch to the Trajectory view.',
          'page.how2': 'Right-click a record row; right-click empty space for session actions.',
          'page.how3': 'Use ↑ / ↓ to move, Enter to run, Esc to close.',
          'page.updateTitle': 'Install plugins',
          'page.updateDesc': 'Every third-party plugin on the Plugins page gains an install entry: read versions from a registry, install the version in the input through the Add plugin path (removing the old copy first), then enable and optionally restart DSH — or use one-click install.',
          'page.updateHow': 'Open Plugins in the sidebar and click the install icon at the right of a card under Installed plugins; in the panel, type or choose a version and press One-click install to use the defaults below.',
          'page.oneClickTitle': 'One-click install',
          'page.oneClickDesc': 'One-click install installs the version in the input and skips both the enable and the restart questions.',
          'page.oneClickEnable': 'Enable the new version automatically',
          'page.oneClickEnableHint': 'When off, one-click install only installs the version, leaves it disabled, and does not restart.',
          'page.oneClickRestart': 'Restart DSH automatically',
          'page.oneClickRestartHint': 'When off, the install-complete panel closes itself.',
          'page.jobStopTitle': 'Background job stop reason',
          'page.jobStopDesc': 'When you stop a running job from the background jobs panel in the session header, you can leave a reason; the reason is appended to the notice injected into the session when the job settles.',
          'page.jobStopHow': 'Open a session, expand the background jobs panel, press stop on a running job, type a reason (optional), then confirm.',
          'page.launcherTitle': 'Sidebar launcher',
          'page.launcherDesc': 'Turns the left sidebar panel buttons into an adaptive icon grid: the column count follows the sidebar width, icons sit above their labels, icons can be dragged to reorder, dropping one icon onto the middle of another forms a folder (like a Windows Start menu folder), and clicking a folder opens its contents in a flyout.',
          'page.launcherToggle': 'Enable the icon grid',
          'page.launcherToggleHint': 'When off, the sidebar keeps the host list; order and folders are remembered.',
          'launcher.groupDefault': 'Group',
          'launcher.count': '{count} panels',
          'launcher.renameHint': 'Click to rename',
          'launcher.dissolve': 'Ungroup',
          'launcher.removeItem': 'Remove from group',
          'page.footer': 'Power-Up {version} · Settings are stored in this browser',
          'page.localOnly': 'This browser only',
          'action.copy': 'Copy content',
          'action.copyHint': 'Copy the full text of this record',
          'action.quote': 'Copy as quote',
          'action.quoteHint': 'Produce a Markdown quote ready to paste',
          'action.insert': 'Quote in composer',
          'action.insertHint': 'Insert the quote into the current composer',
          'action.inspect': 'Open record details',
          'action.inspectHint': 'Open the host record inspector',
          'action.fork': 'Fork from here',
          'action.forkHint': 'Branch with this record and everything before it',
          'action.stepRef': 'Copy step reference',
          'action.stepRefHint': 'Copy "session ID + step ID"; the agent can read the full step data with powerup_step_read',
          'action.export': 'Export trajectory JSON',
          'action.exportHint': 'Save the current trajectory snapshot as JSON',
          'action.session': 'Copy session ID',
          'action.sessionHint': 'Useful in logs and issues',
          'action.panel': 'Open the Power-Up page',
          'action.panelHint': 'Return to this control panel',
          'menu.title': 'Power-Up',
          'menu.record': 'Trajectory record',
          'menu.copy': 'Copy content',
          'menu.quote': 'Copy as quote',
          'menu.insert': 'Quote in composer',
          'menu.inspect': 'Open record details',
          'menu.fork': 'Fork from here',
          'menu.forkHint': 'inclusive',
          'menu.stepRef': 'Copy step reference',
          'menu.noStepRef': 'This record has no referenceable step ID',
          'menu.export': 'Export trajectory JSON',
          'menu.session': 'Copy session ID',
          'menu.panel': 'Open the Power-Up page',
          'menu.noFork': 'No fork position available for this record',
          'menu.blank': 'Session actions',
          'toast.copied': 'Copied',
          'toast.copyFailed': 'Copy failed',
          'toast.inserted': 'Inserted into the composer',
          'toast.insertFallback': 'Composer unavailable; copied to clipboard',
          'toast.forked': 'Session forked',
          'toast.forkFailed': 'Fork failed: {message}',
          'toast.exported': 'Trajectory exported',
          'toast.exportFailed': 'Export failed: {message}',
          'toast.empty': 'This record has no text to copy',
          'toast.actionFailed': 'Action failed: {message}',
          'toast.sessionCopied': 'Session ID copied',
          'toast.stepRefCopied': 'Step reference copied',
          'toast.forkUnavailable': 'This host does not expose the fork API',
          'toast.noSession': 'No session is open',
          'jobStop.title': 'Stop background job',
          'jobStop.subtitle': 'This cannot be undone; running work will be interrupted.',
          'jobStop.close': 'Close',
          'jobStop.reasonLabel': 'Stop reason (optional)',
          'jobStop.reasonPlaceholder': 'e.g. the result is no longer needed',
          'jobStop.reasonNote': 'The reason is appended to the notice injected into the session when the job settles.',
          'jobStop.cancel': 'Cancel',
          'jobStop.confirm': 'Stop job',
          'jobStop.stopping': 'Stopping…',
          'jobStop.failed': 'Could not stop the job: {message}',
          'update.button': 'Install',
          'update.title': 'Install plugin',
          'update.subtitle': 'Install the version in the input; the installed copy is removed first.',
          'update.current': 'Current version',
          'update.versionLabel': 'Version',
          'update.versionPlaceholder': 'Type a version or pick one from the list',
          'update.loadingVersions': 'Reading versions from the registry…',
          'update.loading': 'Reading the plugin and its versions…',
          'update.chooseVersion': 'Choose',
          'update.hideVersions': 'Hide list',
          'update.versionsCount': '{count} versions',
          'update.versionsFailed': 'Could not read versions: {message}',
          'update.versionsEmpty': 'The registry returned no versions',
          'update.latest': 'latest',
          'update.currentTag': 'Current',
          'update.currentAndLatest': 'Current · latest',
          'update.retry': 'Retry',
          'update.registry': 'Registry',
          'update.registryDefault': 'Default registry',
          'update.registryMirror': 'Mainland China mirror',
          'update.registryCustom': 'Custom address',
          'update.registryFrom': 'Versions came from {registry}',
          'update.start': 'Install',
          'update.cancel': 'Cancel',
          'update.close': 'Close',
          'update.step.checking': 'Checking the version…',
          'update.step.removing': 'Removing the old version…',
          'update.step.installing': 'Installing {version}…',
          'update.step.rollback': 'Restoring {version}…',
          'update.step.enabling': 'Enabling…',
          'update.log': 'Install output',
          'update.enableTitle': 'Installed. Enable it now?',
          'update.enableDesc': 'The new version loads only after it is enabled.',
          'update.enableNow': 'Enable now',
          'update.enableLater': 'Enable later',
          'update.enableFailed': 'Could not enable: {message}',
          'update.restartTitle': 'Restart DSH now?',
          'update.restartDesc': 'Restarting closes and reopens DSH; running tasks are interrupted.',
          'update.restartNow': 'Restart now',
          'update.restartLater': 'Restart later',
          'update.restartUnsupported': 'This runtime cannot restart itself: {reason}',
          'update.restarting': 'DSH is restarting; this window will close…',
          'update.restartFailed': 'Restart request failed: {message}',
          'update.selfUpdateWarning': 'Installing Power-Up removes and reinstalls it in the background; this panel closes, then refresh the page.',
          'update.selfUpdating': 'Power-Up is installing in the background…',
          'update.selfRefresh': 'Refresh the page when it finishes.',
          'update.setDefault': 'Set as default',
          'update.defaultTag': 'Default',
          'update.defaultHint': 'The install list starts from this registry',
          'restart.tag': 'Restart needed',
          'restart.tagHint': 'Installed; restart DSH to apply',
          'restart.pending': '{count} plugins need a restart',
          'restart.none': 'No plugins need a restart',
          'restart.action': 'Restart DSH',
          'restart.title': 'Restart DSH?',
          'restart.desc': 'Restarting closes and reopens DSH; running tasks are interrupted.',
          'restart.cancel': 'Cancel',
          'restart.confirm': 'Restart now',
          'update.doneTitle': 'Install complete',
          'update.doneInstalled': '{name} installed {version}.',
          'update.doneDisabled': '{name} {version} is installed but not enabled.',
          'update.doneEnabled': 'The new version is enabled.',
          'update.doneRestart': 'Some changes apply only after DSH restarts.',
          'update.doneAutoClose': 'This panel closes itself in {seconds} seconds.',
          'update.doneButton': 'Done',
          'update.oneClick': 'One-click install',
          'update.oneClickTitle': 'One-click install',
          'update.oneClickHint': 'Installs the version in the input ({version}) and skips the enable and restart questions.',
          'update.oneClickDefaults': 'Auto-enable: {enable} · Auto-restart: {restart}. Change these on the Power-Up page.',
          'update.on': 'on',
          'update.off': 'off',
          'update.oneClickNoVersion': 'Type or choose a version to install first.',
          'update.oneClickEnableFailed': 'The version is installed but could not be enabled. Enable it on the Plugins page.',
          'update.oneClickSkippedEnable': 'Left disabled as configured; enable it on the Plugins page when ready.',
          'update.errorTitle': 'Install failed',
          'update.rollbackOkTitle': 'Previous version restored',
          'update.rollbackOkDesc': 'The install failed, so {name} was rolled back to {version} and is ready to use.',
          'update.rollbackFailedTitle': 'Could not restore the previous version',
          'update.rollbackFailedDesc': 'Automatic rollback failed: {message}. Reinstall it from the Plugins page with “Add plugin”.',
          'update.rollbackUnavailable': 'The previous version is unknown, so no automatic rollback was possible. Reinstall it from the Plugins page.',
          'update.selfTitle': 'Install Power-Up with Add plugin',
          'update.selfDesc': 'Installing Power-Up removes this plugin first, which interrupts this flow.',
          'update.notRemovable': 'DSH manages this plugin; it cannot be installed here.',
          'update.notBundle': 'This package is not a DSH plugin bundle.',
          'update.alreadyInstalled': 'This package is already installed; remove the old version first.',
          'update.notFound': 'That version is not available from the registry.',
          'update.cancelled': 'The install was cancelled.',
          'update.installedChip': 'Not installed',
          'update.unknown': 'Unknown error',
          'update.invalidVersion': 'Enter a valid version, for example 1.2.3.',
          'update.stopProfile': 'This profile cannot hot-remove the plugin; restart DSH and try again.',
          'update.unsupportedTitle': 'Cannot install automatically',
        },
      };

      function detectLocale() {
        try {
          return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
        } catch {
          return 'en';
        }
      }

      function format(template, params) {
        if (params === undefined) return template;
        return template.replace(/\{(\w+)\}/g, (match, key) =>
          Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
      }

      /** Standalone translator used before/without the host locale service. */
      function makeFallbackTranslate() {
        let locale = detectLocale();
        return (key, params) => {
          const table = DICT[locale] ?? DICT.en;
          return format(table[key] ?? DICT.en[key] ?? key, params);
        };
      }

      // ------------------------------------------------------------------
      // Settings store (localStorage, per browser)
      // ------------------------------------------------------------------
      /** One-click update defaults: enable and restart unless the user turned one off. */
      const DEFAULT_SETTINGS = { enabled: true, oneClickEnable: true, oneClickRestart: true, launcher: true };

      function readSettings() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
          if (parsed !== null && typeof parsed === 'object') {
            return {
              enabled: parsed.enabled !== false,
              oneClickEnable: parsed.oneClickEnable !== false,
              oneClickRestart: parsed.oneClickRestart !== false,
              launcher: parsed.launcher !== false,
            };
          }
        } catch {
          /* Private mode or a corrupted value: use the default. */
        }
        return { ...DEFAULT_SETTINGS };
      }

      let settingsValue = readSettings();
      const settingsListeners = new Set();

      function getSettings() {
        return settingsValue;
      }

      function setSettings(patch) {
        settingsValue = { ...settingsValue, ...patch };
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsValue));
        } catch {
          /* The in-memory value still works for this page. */
        }
        for (const listener of [...settingsListeners]) {
          try {
            listener();
          } catch {
            /* A listener must not break the toggle. */
          }
        }
      }

      function subscribeSettings(listener) {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      }

      function useSettings() {
        const [value, setValue] = useState(getSettings);
        useEffect(() => subscribeSettings(() => setValue(getSettings())), []);
        return value;
      }

      // ------------------------------------------------------------------
      // Sidebar launcher: the panel list as an adaptive icon grid
      // ------------------------------------------------------------------
      /** localStorage key holding the launcher's order and folders. */
      const LAUNCHER_STORAGE_KEY = 'dsh-powerup:launcher:v1';
      /** Prefix that marks a top-level entry as a folder instead of a panel. */
      const LAUNCHER_GROUP_PREFIX = 'group:';
      /** Pixel distance before a press turns into a drag. */
      const LAUNCHER_DRAG_THRESHOLD = 6;

      function launcherGroupEntry(groupId) {
        return LAUNCHER_GROUP_PREFIX + groupId;
      }

      function launcherEntryGroupId(entry) {
        return typeof entry === 'string' && entry.startsWith(LAUNCHER_GROUP_PREFIX)
          ? entry.slice(LAUNCHER_GROUP_PREFIX.length)
          : null;
      }

      function makeLauncherGroupId() {
        return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }

      /**
       * Reconcile the saved launcher state with the panels that exist right now.
       * Unknown panel keys (unregistered, unpinned) are dropped; panels without
       * a saved position are appended in host order; folders left empty vanish.
       * Pure so the smoke test can cover the merge rules without a DOM.
       * @param {unknown} raw stored value (already parsed)
       * @param {string[]} panelKeys panel keys in host registration order
       * @returns {{order: string[], groups: Record<string, {id: string, name: string, items: string[]}>}}
       */
      function normalizeLauncherState(raw, panelKeys) {
        const known = new Set(Array.isArray(panelKeys) ? panelKeys : []);
        if (raw === null || typeof raw !== 'object') return { order: [...known], groups: {} };
        const groups = {};
        const assigned = new Set();
        const rawGroups = raw.groups !== null && typeof raw.groups === 'object' ? raw.groups : {};
        for (const [groupId, value] of Object.entries(rawGroups)) {
          if (value === null || typeof value !== 'object' || typeof groupId !== 'string' || groupId === '') continue;
          const items = [];
          const list = Array.isArray(value.items) ? value.items : [];
          for (const key of list) {
            if (typeof key !== 'string' || !known.has(key) || assigned.has(key)) continue;
            assigned.add(key);
            items.push(key);
          }
          if (items.length === 0) continue;
          groups[groupId] = {
            id: groupId,
            name: typeof value.name === 'string' ? value.name : '',
            items,
          };
        }
        const order = [];
        const seen = new Set();
        const rawOrder = Array.isArray(raw.order) ? raw.order : [];
        for (const entry of rawOrder) {
          if (typeof entry !== 'string' || seen.has(entry)) continue;
          const groupId = launcherEntryGroupId(entry);
          if (groupId !== null) {
            if (Object.prototype.hasOwnProperty.call(groups, groupId)) {
              order.push(entry);
              seen.add(entry);
            }
            continue;
          }
          if (!known.has(entry) || assigned.has(entry)) continue;
          order.push(entry);
          seen.add(entry);
        }
        for (const key of known) {
          if (assigned.has(key) || seen.has(key)) continue;
          order.push(key);
          seen.add(key);
        }
        for (const groupId of Object.keys(groups)) {
          const entry = launcherGroupEntry(groupId);
          if (seen.has(entry)) continue;
          order.push(entry);
          seen.add(entry);
        }
        return { order, groups };
      }

      /**
       * DOM-driven controller for the sidebar launcher.
       *
       * It works on the host's own `<nav>` panel list: it adds a marker class,
       * turns the list into an `auto-fill` grid, injects synthetic folder tiles,
       * hides the host rows that moved into a folder, and drives drag sorting
       * and the folder flyout with plain DOM (React owns the rows, so every
       * change here is idempotent and re-applied after the host re-renders).
       *
       * Everything it needs from the plugin arrives through `deps`, which keeps
       * this region self-contained and testable.
       * @param {{t?: Function, format?: Function, isEnabled?: Function, read?: Function, write?: Function, listPanels?: Function}} deps
       */
      function createLauncherCore(deps) {
        const options = deps ?? {};
        const t = typeof options.t === 'function' ? options.t : (key) => key;
        const formatText = typeof options.format === 'function'
          ? options.format
          : (template, params) => String(template).replace(/\{(\w+)\}/g, (match, key) =>
            params !== undefined && params !== null && key in params ? String(params[key]) : match);
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
        const readRaw = typeof options.read === 'function' ? options.read : () => null;
        const writeRaw = typeof options.write === 'function' ? options.write : () => {};
        const listPanels = typeof options.listPanels === 'function' ? options.listPanels : () => [];

        let nav = null;
        let docObserver = null;
        let navObserver = null;
        let healthTimer = null;
        let queued = 0;
        let syncing = false;
        let started = false;
        let state = { order: [], groups: {} };
        let pendingLoad = true;
        let hostTiles = [];
        let folderButtons = new Map();
        let dropLine = null;
        let drag = null;
        let popup = null;

        function warn(message, error) {
          try {
            console.warn('[dsh-powerup] ' + message, error?.message ?? error);
          } catch {
            /* Console output must never break the launcher. */
          }
        }

        function hasDocument() {
          return typeof document !== 'undefined'
            && document !== null
            && typeof document.querySelector === 'function'
            && document.body !== null
            && document.body !== undefined;
        }

        function scheduleSync() {
          if (queued !== 0 || !started) return;
          if (typeof requestAnimationFrame === 'function') {
            queued = requestAnimationFrame(() => {
              queued = 0;
              sync();
            });
            return;
          }
          if (typeof window !== 'undefined' && window !== null && typeof window.setTimeout === 'function') {
            queued = window.setTimeout(() => {
              queued = 0;
              sync();
            }, 0);
          }
        }

        function navLooksLikePanelList(candidate) {
          if (candidate === null || candidate === undefined) return false;
          if (typeof candidate.children !== 'object' || candidate.children === null) return false;
          for (const child of [...candidate.children]) {
            if (child.tagName === 'BUTTON') return true;
            if (child.tagName === 'DIV' && typeof child.querySelector === 'function' && child.querySelector(':scope > button') !== null) return true;
          }
          return false;
        }

        function queryNav() {
          if (!hasDocument()) return null;
          const marked = document.querySelector('nav[class*="panelList"], nav.dsh-powerup-launcher');
          if (marked !== null && marked !== undefined) return marked;
          const candidates = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('nav') : [];
          for (const candidate of candidates) {
            if (navLooksLikePanelList(candidate)) return candidate;
          }
          return null;
        }

        function observeDocument() {
          if (docObserver !== null || typeof MutationObserver !== 'function' || !hasDocument()) return;
          const root = document.body ?? document.documentElement;
          if (root === null || root === undefined) return;
          docObserver = new MutationObserver(() => {
            const next = queryNav();
            if (next === null) return;
            if (docObserver !== null) {
              docObserver.disconnect();
              docObserver = null;
            }
            attachNav(next);
          });
          docObserver.observe(root, { childList: true, subtree: true });
        }

        function attachNav(element) {
          nav = element;
          element.classList.add('dsh-powerup-launcher');
          if (navObserver !== null) navObserver.disconnect();
          if (typeof MutationObserver === 'function') {
            navObserver = new MutationObserver(() => {
              if (!syncing) scheduleSync();
            });
            navObserver.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
          }
          sync();
        }

        /** Resolve the host panel rows (and the "more" launcher) into tile records. */
        function collectHostTiles(container) {
          const byLabel = new Map();
          let panels = [];
          try {
            panels = listPanels() ?? [];
          } catch {
            panels = [];
          }
          if (Array.isArray(panels)) {
            for (const panel of panels) {
              if (panel === null || typeof panel !== 'object') continue;
              if (typeof panel.id !== 'string' || typeof panel.label !== 'string') continue;
              if (!byLabel.has(panel.label)) byLabel.set(panel.label, panel.id);
            }
          }
          const tiles = [];
          const usedKeys = new Set();
          for (const child of [...container.children]) {
            if (child.hasAttribute('data-powerup-folder')) continue;
            if (typeof child.classList === 'object' && child.classList !== null && child.classList.contains('dsh-powerup-drop-line')) continue;
            let gridEl = child;
            let buttonEl = null;
            if (child.tagName === 'BUTTON') buttonEl = child;
            else if (child.tagName === 'DIV') {
              buttonEl = typeof child.querySelector === 'function' ? child.querySelector(':scope > button') : null;
              if (buttonEl === null) continue;
            } else continue;
            const label = buttonEl.getAttribute('aria-label') ?? '';
            if (label === '') continue;
            const isMore = child.tagName === 'DIV' || buttonEl.getAttribute('aria-haspopup') === 'menu';
            let key = isMore ? '__more' : (byLabel.get(label) ?? 'label:' + label);
            if (key !== '__more' && usedKeys.has(key)) {
              let suffix = 2;
              while (usedKeys.has(key + '~' + suffix)) suffix += 1;
              key = key + '~' + suffix;
            }
            usedKeys.add(key);
            gridEl.setAttribute('data-powerup-grid', key);
            if (isMore) gridEl.setAttribute('data-powerup-more', '');
            else gridEl.removeAttribute('data-powerup-more');
            const glyph = typeof gridEl.querySelector === 'function'
              ? gridEl.querySelector('[class*="panelGlyph"], span[aria-hidden="true"]')
              : null;
            tiles.push({
              key,
              label,
              gridEl,
              buttonEl,
              isMore,
              glyphHtml: glyph === null ? '' : glyph.innerHTML,
              active: false,
            });
          }
          return tiles;
        }

        function detectWide(tiles) {
          for (const tile of tiles) {
            if (tile.isMore) continue;
            if (typeof tile.buttonEl.querySelector === 'function' && tile.buttonEl.querySelector('[class*="panelTitle"]') !== null) return true;
            if (tile.buttonEl.children.length >= 2) return true;
          }
          return false;
        }

        function tileByKeyMap() {
          const map = new Map();
          for (const tile of hostTiles) map.set(tile.key, tile);
          return map;
        }

        function buildFolderTile(groupId, group, tiles) {
          let button = folderButtons.get(groupId);
          if (button === undefined || button.isConnected !== true) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'dsh-powerup-folder';
            button.setAttribute('data-powerup-folder', groupId);
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (drag !== null && drag.active) return;
              toggleFolder(groupId, button);
            });
            nav.appendChild(button);
            folderButtons.set(groupId, button);
          }
          button.setAttribute('data-powerup-folder', groupId);
          button.setAttribute('aria-label', group.name === '' ? t('launcher.groupDefault') : group.name);
          button.setAttribute('title', group.name === '' ? t('launcher.groupDefault') : group.name);
          const signature = group.name + '\u0000' + group.items.join('\u0000');
          if (button.getAttribute('data-powerup-signature') !== signature) {
            button.setAttribute('data-powerup-signature', signature);
            button.textContent = '';
            const stack = document.createElement('span');
            stack.className = 'dsh-powerup-folder-stack';
            for (const key of group.items.slice(0, 4)) {
              const tile = tiles.get(key);
              const mini = document.createElement('span');
              mini.className = 'dsh-powerup-folder-mini';
              mini.innerHTML = tile === undefined ? '' : tile.glyphHtml;
              stack.appendChild(mini);
            }
            if (group.items.length === 1) stack.classList.add('is-single');
            const name = document.createElement('span');
            name.className = 'dsh-powerup-folder-name';
            name.textContent = group.name === '' ? t('launcher.groupDefault') : group.name;
            button.append(stack, name);
          }
          return button;
        }

        function hideDropLine() {
          if (dropLine !== null) dropLine.style.display = 'none';
          if (nav !== null && typeof nav.querySelectorAll === 'function') {
            for (const element of nav.querySelectorAll('.dsh-powerup-merge-target')) element.classList.remove('dsh-powerup-merge-target');
          }
        }

        function clearVisuals() {
          closePopup();
          endDrag();
          hideDropLine();
          folderButtons.forEach((button) => button.remove());
          folderButtons = new Map();
          if (dropLine !== null) {
            dropLine.remove();
            dropLine = null;
          }
          if (nav !== null) {
            nav.classList.remove('dsh-powerup-launcher', 'dsh-powerup-launcher-wide');
            for (const tile of hostTiles) {
              tile.gridEl.classList.remove('dsh-powerup-dragging', 'dsh-powerup-merge-target');
              tile.gridEl.style.order = '';
              tile.gridEl.style.display = '';
            }
          }
          hostTiles = [];
        }

        function readPersisted() {
          try {
            const text = readRaw();
            if (typeof text !== 'string' || text === '') return null;
            return JSON.parse(text);
          } catch {
            return null;
          }
        }

        function sync() {
          if (!started || syncing || !hasDocument()) return;
          if (nav === null || nav.isConnected !== true) {
            const next = queryNav();
            if (next === null) {
              if (docObserver === null) observeDocument();
              return;
            }
            attachNav(next);
            return;
          }
          syncing = true;
          try {
            if (isEnabled() !== true) {
              clearVisuals();
              return;
            }
            nav.classList.add('dsh-powerup-launcher');
            hostTiles = collectHostTiles(nav);
            const wide = detectWide(hostTiles);
            nav.classList.toggle('dsh-powerup-launcher-wide', wide);
            const panelKeys = hostTiles.filter((tile) => !tile.isMore).map((tile) => tile.key);
            if (pendingLoad) {
              pendingLoad = false;
              state = normalizeLauncherState(readPersisted(), panelKeys);
            } else {
              state = normalizeLauncherState(state, panelKeys);
            }
            const tiles = tileByKeyMap();
            const memberOf = new Map();
            for (const group of Object.values(state.groups)) {
              for (const key of group.items) memberOf.set(key, group.id);
            }
            const orderIndex = new Map(state.order.map((entry, index) => [entry, index]));
            for (const tile of hostTiles) {
              tile.active = tile.buttonEl.getAttribute('aria-current') === 'page';
              const hidden = wide && memberOf.has(tile.key);
              /* Inline display (not a class): React rewrites className when the
                 active panel changes and would drop an added class. */
              tile.gridEl.style.display = hidden ? 'none' : '';
              if (tile.isMore) tile.gridEl.style.order = String(state.order.length + 4);
              else {
                const position = orderIndex.get(tile.key);
                tile.gridEl.style.order = position === undefined ? '' : String(position);
              }
            }
            const live = new Set();
            for (const [groupId, group] of Object.entries(state.groups)) {
              live.add(groupId);
              const button = buildFolderTile(groupId, group, tiles);
              button.style.display = wide ? '' : 'none';
              const position = orderIndex.get(launcherGroupEntry(groupId));
              button.style.order = position === undefined ? String(state.order.length + 2) : String(position);
              const active = group.items.some((key) => tiles.get(key)?.active === true);
              button.classList.toggle('is-active', active);
            }
            for (const [groupId, button] of [...folderButtons]) {
              if (live.has(groupId)) continue;
              button.remove();
              folderButtons.delete(groupId);
            }
            if (popup !== null) {
              if (state.groups[popup.groupId] === undefined) closePopup();
              else renderPopup();
            }
          } catch (error) {
            warn('launcher sync failed:', error);
          } finally {
            syncing = false;
          }
        }

        function save() {
          try {
            writeRaw(JSON.stringify(state));
          } catch (error) {
            warn('launcher state could not be saved:', error);
          }
        }

        // ----------------------------------------------------------------
        // Folder flyout
        // ----------------------------------------------------------------
        function toggleFolder(groupId, anchor) {
          if (popup !== null && popup.groupId === groupId) {
            closePopup();
            return;
          }
          openFolder(groupId, anchor);
        }

        function openFolder(groupId, anchor) {
          if (!hasDocument() || state.groups[groupId] === undefined) return;
          closePopup();
          const element = document.createElement('div');
          element.className = 'dsh-powerup-folder-pop';
          element.setAttribute('role', 'dialog');
          element.setAttribute('aria-label', state.groups[groupId].name === '' ? t('launcher.groupDefault') : state.groups[groupId].name);
          element.setAttribute('data-powerup-folder-pop', groupId);
          document.body.appendChild(element);
          popup = { element, groupId, anchor };
          renderPopup();
          positionPopup();
          const reveal = () => {
            if (popup !== null && popup.element === element) element.classList.add('is-open');
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
          else reveal();
          document.addEventListener('pointerdown', onPopupOutside, true);
          document.addEventListener('keydown', onPopupKey, true);
          if (typeof window !== 'undefined' && window !== null && typeof window.addEventListener === 'function') {
            window.addEventListener('resize', closePopup, true);
            window.addEventListener('scroll', onPopupScroll, true);
          }
        }

        function closePopup() {
          if (popup === null) return;
          const element = popup.element;
          popup = null;
          document.removeEventListener('pointerdown', onPopupOutside, true);
          document.removeEventListener('keydown', onPopupKey, true);
          if (typeof window !== 'undefined' && window !== null && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', closePopup, true);
            window.removeEventListener('scroll', onPopupScroll, true);
          }
          element.classList.remove('is-open');
          const remove = () => {
            if (element.parentNode !== null) element.remove();
          };
          if (typeof window !== 'undefined' && window !== null && typeof window.setTimeout === 'function') {
            window.setTimeout(remove, 170);
          } else {
            remove();
          }
        }

        function onPopupOutside(event) {
          if (popup === null) return;
          const target = event.target;
          if (target === null || target === undefined) return;
          if (typeof popup.element.contains === 'function' && popup.element.contains(target)) return;
          if (popup.anchor !== null && popup.anchor !== undefined && typeof popup.anchor.contains === 'function' && popup.anchor.contains(target)) return;
          closePopup();
        }

        function onPopupKey(event) {
          if (popup === null || event.key !== 'Escape') return;
          const target = event.target;
          const tag = target !== null && target !== undefined && typeof target.tagName === 'string' ? target.tagName : '';
          if (tag === 'INPUT' && typeof popup.element.contains === 'function' && popup.element.contains(target)) return;
          closePopup();
        }

        function onPopupScroll(event) {
          if (popup === null) return;
          if (typeof popup.element.contains === 'function' && popup.element.contains(event.target)) return;
          closePopup();
        }

        function positionPopup() {
          if (popup === null) return;
          const anchor = popup.anchor;
          const element = popup.element;
          if (anchor === null || anchor === undefined || typeof anchor.getBoundingClientRect !== 'function') return;
          const rect = anchor.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          const width = element.offsetWidth || 0;
          const height = element.offsetHeight || 0;
          const viewWidth = (typeof window !== 'undefined' && window !== null && window.innerWidth) || 1280;
          const viewHeight = (typeof window !== 'undefined' && window !== null && window.innerHeight) || 900;
          const gap = 8;
          const margin = 10;
          let left = rect.right + gap;
          let originX = 'left';
          if (left + width > viewWidth - margin) {
            const alternate = rect.left - gap - width;
            if (alternate >= margin) {
              left = alternate;
              originX = 'right';
            } else {
              left = Math.max(margin, viewWidth - width - margin);
            }
          }
          const top = Math.max(margin, Math.min(rect.top - 6, viewHeight - height - margin));
          element.style.left = Math.round(left) + 'px';
          element.style.top = Math.round(top) + 'px';
          element.style.transformOrigin = originX + ' 22%';
        }

        function renderPopup() {
          if (popup === null) return;
          const group = state.groups[popup.groupId];
          if (group === undefined) {
            closePopup();
            return;
          }
          const element = popup.element;
          element.textContent = '';
          const head = document.createElement('div');
          head.className = 'dsh-powerup-folder-pop-head';
          const title = document.createElement('button');
          title.type = 'button';
          title.className = 'dsh-powerup-folder-pop-title';
          title.textContent = group.name === '' ? t('launcher.groupDefault') : group.name;
          title.setAttribute('title', t('launcher.renameHint'));
          title.addEventListener('click', beginRename);
          const count = document.createElement('span');
          count.className = 'dsh-powerup-folder-pop-count';
          count.textContent = formatText(t('launcher.count'), { count: group.items.length });
          const dissolve = document.createElement('button');
          dissolve.type = 'button';
          dissolve.className = 'dsh-powerup-folder-pop-action';
          dissolve.textContent = t('launcher.dissolve');
          dissolve.addEventListener('click', () => dissolveGroup(popup === null ? null : popup.groupId));
          head.append(title, count, dissolve);
          const grid = document.createElement('div');
          grid.className = 'dsh-powerup-folder-grid';
          const tiles = tileByKeyMap();
          for (const key of group.items) {
            const tile = tiles.get(key);
            if (tile === undefined) continue;
            const item = document.createElement('div');
            item.className = 'dsh-powerup-folder-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', tile.label);
            const glyph = document.createElement('span');
            glyph.className = 'dsh-powerup-folder-item-glyph';
            glyph.innerHTML = tile.glyphHtml;
            const label = document.createElement('span');
            label.className = 'dsh-powerup-folder-item-label';
            label.textContent = tile.label;
            const remove = document.createElement('span');
            remove.className = 'dsh-powerup-folder-item-remove';
            remove.setAttribute('role', 'button');
            remove.setAttribute('tabindex', '0');
            remove.setAttribute('aria-label', t('launcher.removeItem'));
            remove.setAttribute('title', t('launcher.removeItem'));
            remove.textContent = '\u00d7';
            remove.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              removeFromGroup(popup === null ? null : popup.groupId, key);
            });
            remove.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              removeFromGroup(popup === null ? null : popup.groupId, key);
            });
            item.append(glyph, label, remove);
            item.addEventListener('click', () => selectPanel(tile));
            item.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              selectPanel(tile);
            });
            grid.appendChild(item);
          }
          element.append(head, grid);
          positionPopup();
        }

        function beginRename() {
          if (popup === null) return;
          const group = state.groups[popup.groupId];
          if (group === undefined) return;
          const current = popup.element.querySelector('.dsh-powerup-folder-pop-title');
          if (current === null) return;
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'dsh-powerup-folder-pop-input';
          input.value = group.name;
          input.placeholder = t('launcher.groupDefault');
          input.setAttribute('maxlength', '24');
          const commit = () => {
            if (popup === null) return;
            const target = state.groups[popup.groupId];
            if (target === undefined) return;
            const name = input.value.trim().slice(0, 24);
            if (name === target.name) {
              renderPopup();
              return;
            }
            state = { order: state.order, groups: { ...state.groups, [popup.groupId]: { ...target, name } } };
            save();
            sync();
          };
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              renderPopup();
            }
          });
          input.addEventListener('blur', commit);
          current.replaceWith(input);
          if (typeof input.focus === 'function') {
            input.focus();
            if (typeof input.select === 'function') input.select();
          }
        }

        function selectPanel(tile) {
          try {
            tile.buttonEl.click();
          } catch (error) {
            warn('panel could not be selected:', error);
          }
          closePopup();
        }

        function removeFromGroup(groupId, key) {
          if (groupId === null || typeof groupId !== 'string' || typeof key !== 'string') return;
          const group = state.groups[groupId];
          if (group === undefined) return;
          const items = group.items.filter((entry) => entry !== key);
          const order = state.order.filter((entry) => entry !== key);
          const groups = { ...state.groups };
          if (items.length === 0) {
            delete groups[groupId];
            state = { order: order.filter((entry) => entry !== launcherGroupEntry(groupId)), groups };
          } else {
            groups[groupId] = { ...group, items };
            order.push(key);
            state = { order, groups };
          }
          save();
          sync();
        }

        function dissolveGroup(groupId) {
          if (groupId === null || typeof groupId !== 'string') return;
          const group = state.groups[groupId];
          if (group === undefined) return;
          const groups = { ...state.groups };
          delete groups[groupId];
          const order = state.order
            .filter((entry) => entry !== launcherGroupEntry(groupId))
            .concat(group.items.filter((key) => !state.order.includes(key)));
          state = { order, groups };
          save();
          closePopup();
          sync();
        }

        // ----------------------------------------------------------------
        // Drag sorting and folder merging
        // ----------------------------------------------------------------
        function topLevelCandidates(excludeKey) {
          const candidates = [];
          for (const entry of state.order) {
            if (entry === excludeKey) continue;
            const groupId = launcherEntryGroupId(entry);
            if (groupId !== null) {
              const button = folderButtons.get(groupId);
              if (button !== undefined && button.isConnected === true) candidates.push({ key: entry, el: button, kind: 'folder' });
              continue;
            }
            const tile = hostTiles.find((candidate) => candidate.key === entry);
            if (tile === undefined) continue;
            if (tile.gridEl.style.display === 'none') continue;
            candidates.push({ key: entry, el: tile.gridEl, kind: 'panel' });
          }
          return candidates;
        }

        function describeTile(target) {
          if (target === null || target === undefined || typeof target.closest !== 'function') return null;
          const button = target.closest('button');
          if (button === null || nav === null || !nav.contains(button)) return null;
          const folderId = button.getAttribute('data-powerup-folder');
          if (folderId !== null) {
            const group = state.groups[folderId];
            if (group === undefined) return null;
            return { kind: 'folder', key: launcherGroupEntry(folderId), gridEl: button, label: group.name };
          }
          const tile = hostTiles.find((candidate) => candidate.buttonEl === button);
          if (tile === undefined || tile.isMore) return null;
          return { kind: 'panel', key: tile.key, gridEl: tile.gridEl, label: tile.label };
        }

        function onPointerDown(event) {
          if (!started || event.button !== undefined && event.button !== 0) return;
          if (nav === null || !nav.classList.contains('dsh-powerup-launcher-wide')) return;
          if (popup !== null && typeof popup.element.contains === 'function' && popup.element.contains(event.target)) return;
          const descriptor = describeTile(event.target);
          if (descriptor === null) return;
          drag = {
            descriptor,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            ghost: null,
            offsetX: 0,
            offsetY: 0,
            drop: null,
          };
          document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
          document.addEventListener('pointerup', onPointerUp, true);
          document.addEventListener('pointercancel', onPointerUp, true);
          document.addEventListener('keydown', onDragKey, true);
        }

        function onDragKey(event) {
          if (event.key !== 'Escape') return;
          endDrag();
        }

        function beginDrag() {
          if (drag === null) return;
          drag.active = true;
          closePopup();
          const gridEl = drag.descriptor.gridEl;
          const rect = gridEl.getBoundingClientRect();
          const ghost = gridEl.cloneNode(true);
          ghost.className = 'dsh-powerup-drag-ghost';
          ghost.removeAttribute('data-powerup-grid');
          ghost.removeAttribute('data-powerup-more');
          ghost.removeAttribute('data-powerup-host');
          ghost.removeAttribute('aria-label');
          ghost.style.width = rect.width + 'px';
          ghost.style.height = rect.height + 'px';
          ghost.style.left = rect.left + 'px';
          ghost.style.top = rect.top + 'px';
          ghost.style.order = '';
          document.body.appendChild(ghost);
          drag.ghost = ghost;
          drag.offsetX = drag.startX - rect.left;
          drag.offsetY = drag.startY - rect.top;
          gridEl.classList.add('dsh-powerup-dragging');
          hideDropLine();
        }

        function moveGhost(x, y) {
          if (drag === null || drag.ghost === null) return;
          drag.ghost.style.left = Math.round(x - drag.offsetX) + 'px';
          drag.ghost.style.top = Math.round(y - drag.offsetY) + 'px';
        }

        function onPointerMove(event) {
          if (drag === null) return;
          if (!drag.active) {
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.sqrt(dx * dx + dy * dy) < LAUNCHER_DRAG_THRESHOLD) return;
            beginDrag();
          }
          if (typeof event.preventDefault === 'function') event.preventDefault();
          moveGhost(event.clientX, event.clientY);
          updateDrop(event.clientX, event.clientY);
        }

        function updateDrop(x, y) {
          if (drag === null || !drag.active || nav === null) return;
          const navRect = nav.getBoundingClientRect();
          if (x < navRect.left - 24 || x > navRect.right + 24 || y < navRect.top - 24) {
            /* Released far outside the launcher: drop is a no-op, not an append. */
            drag.drop = null;
            hideDropLine();
            return;
          }
          const candidates = topLevelCandidates(drag.descriptor.key);
          let drop = null;
          for (const candidate of candidates) {
            if (candidate.el === undefined || typeof candidate.el.getBoundingClientRect !== 'function') continue;
            const rect = candidate.el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const nearCenter = Math.abs(x - centerX) <= rect.width * 0.28 && Math.abs(y - centerY) <= rect.height * 0.32;
            if (nearCenter) {
              drop = { kind: 'merge', target: candidate };
            } else {
              drop = { kind: 'insert', index: candidates.indexOf(candidate) + (x < centerX ? 0 : 1), anchor: rect, after: x >= centerX };
            }
            break;
          }
          if (drop === null) {
            let index = candidates.length;
            for (let cursor = 0; cursor < candidates.length; cursor += 1) {
              const rect = candidates[cursor].el.getBoundingClientRect();
              if (y < rect.top) {
                index = cursor;
                break;
              }
              if (y <= rect.bottom && x < rect.left + rect.width / 2) {
                index = cursor;
                break;
              }
            }
            const anchor = index < candidates.length && candidates[index] !== undefined
              ? candidates[index].el.getBoundingClientRect()
              : (candidates.length > 0 ? candidates[candidates.length - 1].el.getBoundingClientRect() : null);
            drop = { kind: 'insert', index, anchor, after: index >= candidates.length };
          }
          drag.drop = drop;
          paintDrop(drop, candidates);
        }

        function paintDrop(drop, candidates) {
          if (nav === null) return;
          for (const candidate of candidates) candidate.el.classList.remove('dsh-powerup-merge-target');
          if (drop.kind === 'merge') {
            hideDropLine();
            if (drop.target !== undefined && drop.target.el !== undefined) drop.target.el.classList.add('dsh-powerup-merge-target');
            return;
          }
          let rect = drop.anchor;
          let after = drop.after === true;
          if (rect === null || rect === undefined) {
            if (drop.index < candidates.length && candidates[drop.index] !== undefined) rect = candidates[drop.index].el.getBoundingClientRect();
            else if (candidates.length > 0) {
              rect = candidates[candidates.length - 1].el.getBoundingClientRect();
              after = true;
            }
          }
          if (rect === null || rect === undefined) {
            hideDropLine();
            return;
          }
          if (dropLine === null) {
            dropLine = document.createElement('div');
            dropLine.className = 'dsh-powerup-drop-line';
            dropLine.setAttribute('aria-hidden', 'true');
            nav.appendChild(dropLine);
          }
          const navRect = nav.getBoundingClientRect();
          dropLine.style.left = Math.round((after ? rect.right + 1 : rect.left - 1) - navRect.left) + 'px';
          dropLine.style.top = Math.round(rect.top - navRect.top) + 'px';
          dropLine.style.height = Math.round(rect.height) + 'px';
          dropLine.style.display = 'block';
        }

        function endDrag() {
          document.removeEventListener('pointermove', onPointerMove, { capture: true, passive: false });
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('pointercancel', onPointerUp, true);
          document.removeEventListener('keydown', onDragKey, true);
          if (drag !== null) {
            if (drag.ghost !== null) drag.ghost.remove();
            if (drag.descriptor !== undefined && drag.descriptor.gridEl !== undefined) drag.descriptor.gridEl.classList.remove('dsh-powerup-dragging');
          }
          hideDropLine();
          drag = null;
        }

        function suppressNextClick() {
          const swallow = (event) => {
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
          };
          document.addEventListener('click', swallow, true);
          if (typeof window !== 'undefined' && window !== null && typeof window.setTimeout === 'function') {
            window.setTimeout(() => document.removeEventListener('click', swallow, true), 80);
          } else {
            document.removeEventListener('click', swallow, true);
          }
        }

        function onPointerUp() {
          if (drag === null) return;
          const active = drag.active;
          const descriptor = drag.descriptor;
          const drop = drag.drop;
          endDrag();
          if (!active) return;
          suppressNextClick();
          if (drop !== null && drop.kind === 'merge' && drop.target !== undefined) {
            performMerge(descriptor.key, drop.target.key);
          } else if (drop !== null && drop.kind === 'insert') {
            performReorder(descriptor.key, drop.index);
          } else {
            sync();
          }
        }

        function performReorder(key, index) {
          const order = state.order.filter((entry) => entry !== key);
          const clamped = Math.max(0, Math.min(index, order.length));
          order.splice(clamped, 0, key);
          state = { order: dedupeEntries(order), groups: state.groups };
          save();
          sync();
        }

        function dedupeEntries(entries) {
          const seen = new Set();
          const result = [];
          for (const entry of entries) {
            if (typeof entry !== 'string' || seen.has(entry)) continue;
            seen.add(entry);
            result.push(entry);
          }
          return result;
        }

        function performMerge(sourceKey, targetKey) {
          if (sourceKey === targetKey) return;
          const sourceGroupId = launcherEntryGroupId(sourceKey);
          const targetGroupId = launcherEntryGroupId(targetKey);
          if (sourceGroupId !== null && sourceGroupId === targetGroupId) return;
          const groups = { ...state.groups };
          let order = [...state.order];
          let sourceItems = [];
          let sourceName = '';
          if (sourceGroupId !== null) {
            const source = groups[sourceGroupId];
            if (source === undefined) return;
            sourceItems = [...source.items];
            sourceName = source.name;
            delete groups[sourceGroupId];
          } else {
            sourceItems = [sourceKey];
          }
          order = order.filter((entry) => entry !== sourceKey);
          if (targetGroupId !== null) {
            const target = groups[targetGroupId];
            if (target === undefined) return;
            const items = [...target.items];
            for (const key of sourceItems) if (!items.includes(key)) items.push(key);
            groups[targetGroupId] = { ...target, items, name: target.name !== '' ? target.name : sourceName };
          } else {
            const groupId = sourceGroupId !== null ? sourceGroupId : makeLauncherGroupId();
            const items = [];
            for (const key of sourceItems) if (!items.includes(key)) items.push(key);
            if (!items.includes(targetKey)) items.push(targetKey);
            groups[groupId] = { id: groupId, name: sourceName, items };
            const position = order.indexOf(targetKey);
            if (position >= 0) order[position] = launcherGroupEntry(groupId);
            else order.push(launcherGroupEntry(groupId));
          }
          state = { order: dedupeEntries(order), groups };
          save();
          sync();
        }

        function start() {
          if (started || !hasDocument()) return;
          started = true;
          document.addEventListener('pointerdown', onPointerDown, true);
          const element = queryNav();
          if (element !== null) attachNav(element);
          else observeDocument();
          if (typeof window !== 'undefined' && window !== null && typeof window.setInterval === 'function') {
            healthTimer = window.setInterval(() => {
              if (!started) return;
              if (nav !== null && nav.isConnected === true) return;
              const next = queryNav();
              if (next !== null) attachNav(next);
              else if (docObserver === null) observeDocument();
            }, 2000);
          }
          sync();
        }

        function stop() {
          started = false;
          if (queued !== 0) {
            try {
              if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(queued);
              else if (typeof window !== 'undefined' && window !== null && typeof window.clearTimeout === 'function') window.clearTimeout(queued);
            } catch {
              /* A cancelled frame is already gone. */
            }
            queued = 0;
          }
          if (healthTimer !== null) {
            try {
              if (typeof window.clearInterval === 'function') window.clearInterval(healthTimer);
            } catch {
              /* Nothing else to clear. */
            }
            healthTimer = null;
          }
          if (navObserver !== null) {
            navObserver.disconnect();
            navObserver = null;
          }
          if (docObserver !== null) {
            docObserver.disconnect();
            docObserver = null;
          }
          if (typeof document !== 'undefined' && document !== null && typeof document.removeEventListener === 'function') {
            document.removeEventListener('pointerdown', onPointerDown, true);
          }
          clearVisuals();
          state = { order: [], groups: {} };
          pendingLoad = true;
          nav = null;
        }

        return {
          start,
          stop,
          sync,
          // Exposed for the smoke test only; the plugin never calls these.
          __debug: {
            getState: () => state,
            setState: (next) => {
              state = normalizeLauncherState(next, hostTiles.filter((tile) => !tile.isMore).map((tile) => tile.key));
            },
            getNav: () => nav,
          },
        };
      }

      /**
       * Start the sidebar launcher upgrade. The core owns all DOM work; this
       * adapter supplies translations, the settings flag, storage, and the
       * registered panel ids that key the saved order and folders.
       * @param {object} ctx client plugin context
       * @returns {object | null} the core, or null when the host has no DOM
       */
      function installLauncher(ctx) {
        const listPanels = () => {
          try {
            const slots = ctx.get('slots');
            if (slots === undefined || slots === null || typeof slots.entriesOfSlot !== 'function') return [];
            const entries = slots.entriesOfSlot('sidebar.panellist');
            if (!Array.isArray(entries)) return [];
            return entries.map((entry) => {
              const options = entry?.options ?? {};
              let label;
              try {
                label = typeof options.label === 'function' ? options.label() : options.label;
              } catch {
                label = undefined;
              }
              return { id: options.id, label };
            });
          } catch {
            return [];
          }
        };
        const core = createLauncherCore({
          t: (key, params) => translateCurrent(key, params),
          format,
          isEnabled: () => getSettings().launcher !== false,
          read: () => {
            try {
              return localStorage.getItem(LAUNCHER_STORAGE_KEY);
            } catch {
              return null;
            }
          },
          write: (value) => {
            try {
              localStorage.setItem(LAUNCHER_STORAGE_KEY, value);
            } catch {
              /* The in-memory order still works for this page. */
            }
          },
          listPanels,
        });
        ctx.effect(() => {
          core.start();
          const off = subscribeSettings(() => core.sync());
          return () => {
            off();
            core.stop();
          };
        }, 'dsh-powerup: sidebar launcher');
        return core;
      }

      // ------------------------------------------------------------------
      // Session-scoped bridge
      // ------------------------------------------------------------------
      /**
       * Latest values published by the hidden header utility. `shell.overlay`
       * is root-scoped and cannot read session hooks, so the bridge is the only
       * place where `sessionId`, `useTrajectory` and `inputActions` meet.
       */
      const bridge = {
        token: null,
        sessionId: undefined,
        trajectory: undefined,
        inputActions: undefined,
      };

      function PowerUpBridge({ sessionId, useTrajectory, inputActions }) {
        const snapshot = typeof useTrajectory === 'function' ? useTrajectory((value) => value) : undefined;
        useLayoutEffect(() => {
          const token = {};
          bridge.token = token;
          bridge.sessionId = sessionId;
          bridge.trajectory = snapshot;
          bridge.inputActions = inputActions;
          return () => {
            if (bridge.token === token) {
              bridge.token = null;
              bridge.sessionId = undefined;
              bridge.trajectory = undefined;
              bridge.inputActions = undefined;
            }
          };
        }, [sessionId, snapshot, inputActions]);
        return null;
      }

      // ------------------------------------------------------------------
      // Icons (16-grid, currentColor, host stroke convention)
      // ------------------------------------------------------------------
      const ICON_VIEW_BOX = '0 0 16 16';

      function Icon({ size = 16, children }) {
        return h('svg', {
          width: size,
          height: size,
          viewBox: ICON_VIEW_BOX,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        }, children);
      }

      function LauncherIcon({ size = 16 }) {
        return h(Icon, { size },
          h('rect', {
            x: '2.6', y: '2.6', width: '4.6', height: '4.6', rx: '1.3',
            stroke: 'currentColor', strokeWidth: '1.2',
          }),
          h('rect', {
            x: '8.8', y: '2.6', width: '4.6', height: '4.6', rx: '1.3',
            stroke: 'currentColor', strokeWidth: '1.2',
          }),
          h('rect', {
            x: '2.6', y: '8.8', width: '4.6', height: '4.6', rx: '1.3',
            stroke: 'currentColor', strokeWidth: '1.2',
          }),
          h('path', {
            d: 'M9.4 11.1h3.4M11.1 9.4v3.4',
            stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round',
          }),
        );
      }

      function PowerUpLineIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M4.4 6.9 8 3.3l3.6 3.6',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.4',
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M4.4 11.7 8 8.1l3.6 3.6',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.4',
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M6.3 13.9h3.4', fill: 'none', stroke: 'currentColor',
            strokeWidth: '1.4', strokeLinecap: 'round',
          }),
        );
      }

      function BrandMark({ size = 56 }) {
        return h('svg', {
          width: size, height: size, viewBox: '0 0 256 256', fill: 'none', 'aria-hidden': 'true',
        },
        h('defs', null,
          h('linearGradient', {
            id: 'dsh-powerup-brand-bg', x1: '32', y1: '24', x2: '224', y2: '232',
            gradientUnits: 'userSpaceOnUse',
          },
          h('stop', { stopColor: '#8B5CF6' }),
          h('stop', { offset: '0.55', stopColor: '#6D3BE0' }),
          h('stop', { offset: '1', stopColor: '#4C1D95' }),
          ),
          h('linearGradient', {
            id: 'dsh-powerup-brand-chevron', x1: '78', y1: '56', x2: '178', y2: '178',
            gradientUnits: 'userSpaceOnUse',
          },
          h('stop', { stopColor: '#FFFFFF' }),
          h('stop', { offset: '1', stopColor: '#D8FFF4' }),
          ),
        ),
        h('rect', { x: '16', y: '16', width: '224', height: '224', rx: '56', fill: 'url(#dsh-powerup-brand-bg)' }),
        h('path', {
          d: 'M78 102 128 56l50 46', stroke: 'url(#dsh-powerup-brand-chevron)',
          strokeWidth: '22', strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M78 178 128 132l50 46', stroke: '#9DF2DB',
          strokeWidth: '22', strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', { d: 'M96 212h64', stroke: '#FFC94D', strokeWidth: '10', strokeLinecap: 'round' }),
        );
      }

      function CopyIcon({ size = 16 }) {
        return h(Icon, { size },
          h('rect', {
            x: '5.2', y: '5.2', width: '8.3', height: '8.3', rx: '2',
            stroke: 'currentColor', strokeWidth: '1.3',
          }),
          h('path', {
            d: 'M10.8 5.2V4.1A1.6 1.6 0 0 0 9.2 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v5.1a1.6 1.6 0 0 0 1.6 1.6h1.1',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      function QuoteIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M5.4 4.1C4.1 4.8 3.3 5.9 3.3 7.4v4.3h4.2V7.4H5.6c0-.8.4-1.4 1.1-1.8L5.4 4.1Zm6 0C10.1 4.8 9.3 5.9 9.3 7.4v4.3h4.2V7.4h-1.9c0-.8.4-1.4 1.1-1.8l-1.3-1.5Z',
            fill: 'currentColor',
          }),
        );
      }

      function ComposerIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M8 2.7v6.5M5.4 6.9 8 9.5l2.6-2.6',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M3 11.7v.8A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-.8',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      function InspectIcon({ size = 16 }) {
        return h(Icon, { size },
          h('circle', {
            cx: '7.1', cy: '7.1', r: '3.7', stroke: 'currentColor', strokeWidth: '1.3',
          }),
          h('path', {
            d: 'm9.9 9.9 3 3', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      function ForkIcon({ size = 16 }) {
        return h(Icon, { size },
          h('circle', { cx: '4', cy: '3.5', r: '1.5', stroke: 'currentColor', strokeWidth: '1.2' }),
          h('circle', { cx: '4', cy: '12.5', r: '1.5', stroke: 'currentColor', strokeWidth: '1.2' }),
          h('circle', { cx: '12', cy: '8', r: '1.5', stroke: 'currentColor', strokeWidth: '1.2' }),
          h('path', {
            d: 'M4 5v6M4 8h4.2a2.8 2.8 0 0 0 2.8-2.8V6.5',
            stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round',
          }),
        );
      }

      function ExportIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M8 2.6v6.8M5.3 6.7 8 9.4l2.7-2.7',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M3 11.5v.9A1.6 1.6 0 0 0 4.6 14h6.8a1.6 1.6 0 0 0 1.6-1.6v-.9',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      function HashIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M6.2 2.6 5 13.4M11 2.6 9.8 13.4M3.2 6.2h9.6M2.8 9.8h9.6',
            stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round',
          }),
        );
      }

      function TagIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M2.9 7.2V3.6a.7.7 0 0 1 .7-.7h3.6a.7.7 0 0 1 .5.2l5.4 5.4a.9.9 0 0 1 0 1.3l-2.9 2.9a.9.9 0 0 1-1.3 0L3.1 7.7a.7.7 0 0 1-.2-.5Z',
            stroke: 'currentColor', strokeWidth: '1.25', strokeLinejoin: 'round',
          }),
          h('circle', { cx: '5.5', cy: '5.5', r: '.85', fill: 'currentColor' }),
        );
      }

      function LayoutIcon({ size = 16 }) {
        return h(Icon, { size },
          h('rect', {
            x: '2.4', y: '2.8', width: '11.2', height: '10.4', rx: '1.8',
            stroke: 'currentColor', strokeWidth: '1.3',
          }),
          h('path', { d: 'M6.2 2.8v10.4', stroke: 'currentColor', strokeWidth: '1.3' }),
        );
      }

      function UpdateIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M8 10.6V3.1M5.2 5.9 8 3.1l2.8 2.8',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M2.9 10.4v1A1.6 1.6 0 0 0 4.5 13h7a1.6 1.6 0 0 0 1.6-1.6v-1',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      /** A lightning bolt: the one-click update action. */
      function QuickIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M9.1 1.9 3.9 8.7h3.1L6.9 14l5.2-6.8H9L9.1 1.9Z',
            fill: 'currentColor',
          }),
        );
      }

      function StopIcon({ size = 16 }) {
        return h(Icon, { size },
          h('rect', {
            x: '3.2', y: '3.2', width: '9.6', height: '9.6', rx: '1.7',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.3',
          }),
        );
      }

      function CheckIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'm3.2 8.4 3 3 6.6-6.8',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.6',
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
        );
      }

      function ChevronDownIcon({ size = 12 }) {
        return h(Icon, { size },
          h('path', {
            d: 'm4 6 4 4 4-4',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.4',
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
        );
      }

      function StarIcon({ size = 12 }) {
        return h(Icon, { size },
          h('path', {
            d: 'm8 2.6 1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 10.8l-3.2 1.7.6-3.6L2.8 6.4l3.6-.5L8 2.6Z',
            fill: 'currentColor',
          }),
        );
      }

      function WarnIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M8 2.6 14 13H2L8 2.6Z',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M8 6.3v3.1M8 11.4v.1',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
          }),
        );
      }

      // ------------------------------------------------------------------
      // CSS — host tokens only (except the brand SVG artwork)
      // ------------------------------------------------------------------
      /**
       * Sidebar launcher styles. Every rule is scoped under the marker class we
       * add to the host panel list, so the untouched host rules still describe
       * the collapsed 56px rail (we remove `.dsh-powerup-launcher-wide` there).
       * The grid uses `auto-fill` + `minmax`, so the column count follows the
       * sidebar width instead of a fixed number.
       */
      const LAUNCHER_CSS = `
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide{position:relative;display:grid!important;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));grid-auto-rows:min-content;gap:2px;align-content:start;align-items:stretch;margin:0 0 10px;padding:2px 0}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button,nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]>button,.dsh-powerup-folder{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:auto;min-width:0;height:auto;min-height:52px;margin:0;padding:6px 2px 5px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:14px;text-align:center;cursor:pointer;user-select:none;-webkit-user-select:none;transition:background .12s ease,color .12s ease,transform .12s ease}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button:hover,nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]>button:hover,.dsh-powerup-folder:hover{background:var(--dsw-alias-interactive-bg-hover)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button:active,nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]>button:active,.dsh-powerup-folder:active{transform:scale(.96)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button[class*="panelActive"],nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]>button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]{display:flex!important;flex-direction:column;min-width:0;margin:0}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelGlyph"]{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelGlyph"] svg{width:20px;height:20px}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelTitle"]{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;font-weight:400;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button:hover [class*="panelTitle"]{color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder{position:relative;list-style:none;flex:none}
.dsh-powerup-folder-stack{display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:1px;width:24px;height:24px;padding:2px;box-sizing:border-box;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);flex:none}
.dsh-powerup-folder-mini{display:inline-flex;align-items:center;justify-content:center;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);opacity:.85}
.dsh-powerup-folder-mini svg{width:9px;height:9px}
.dsh-powerup-folder-stack.is-single{grid-template-columns:1fr;grid-template-rows:1fr}
.dsh-powerup-folder-stack.is-single .dsh-powerup-folder-mini svg{width:14px;height:14px}
.dsh-powerup-folder-name{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder.is-active .dsh-powerup-folder-name{color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder.is-active .dsh-powerup-folder-stack{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent)}
.dsh-powerup-dragging{opacity:.32}
.dsh-powerup-merge-target{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 17%,transparent)!important;box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-powerup-drop-line{position:absolute;z-index:6;display:none;width:2px;border-radius:999px;background:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent);pointer-events:none}
.dsh-powerup-drag-ghost{position:fixed;z-index:1800;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 2px 5px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:14px;pointer-events:none;opacity:.96;transform:scale(1.05);transition:opacity .1s ease}
.dsh-powerup-drag-ghost [class*="panelGlyph"]{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}
.dsh-powerup-drag-ghost [class*="panelGlyph"] svg{width:20px;height:20px}
.dsh-powerup-drag-ghost [class*="panelTitle"]{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder-pop{position:fixed;z-index:1800;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:max-content;min-width:196px;max-width:min(440px,calc(100vw - 24px));max-height:min(72vh,440px);padding:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;opacity:0;transform:scale(.92);transition:opacity .13s ease,transform .17s cubic-bezier(.22,.9,.3,1.06)}
.dsh-powerup-folder-pop.is-open{opacity:1;transform:scale(1)}
.dsh-powerup-folder-pop-head{display:flex;align-items:center;gap:6px;min-width:0;padding:0 2px}
.dsh-powerup-folder-pop-title{flex:1 1 auto;min-width:0;padding:2px 5px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;font-weight:500;text-align:left;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-folder-pop-title:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-folder-pop-input{flex:1 1 auto;min-width:0;height:22px;padding:0 5px;border:.5px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;outline:none}
.dsh-powerup-folder-pop-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}
.dsh-powerup-folder-pop-action{flex:none;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;white-space:nowrap}
.dsh-powerup-folder-pop-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:2px;align-content:start;max-height:min(60vh,340px);overflow:auto;padding:2px}
.dsh-powerup-folder-item{position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;min-height:54px;padding:6px 2px 5px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:14px;cursor:pointer;transition:background .12s ease}
.dsh-powerup-folder-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-folder-item:focus{outline:none}
.dsh-powerup-folder-item:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.dsh-powerup-folder-item-glyph{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-powerup-folder-item-glyph svg{width:20px;height:20px}
.dsh-powerup-folder-item-label{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder-item:hover .dsh-powerup-folder-item-label{color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder-item-remove{position:absolute;top:1px;right:2px;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:15px;cursor:pointer;opacity:0;transition:opacity .12s ease}
.dsh-powerup-folder-item:hover .dsh-powerup-folder-item-remove,.dsh-powerup-folder-item-remove:focus-visible{opacity:1}
.dsh-powerup-folder-item-remove:hover{color:var(--dsw-alias-label-primary)}
@media (prefers-reduced-motion:reduce){nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button,nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-more]>button,.dsh-powerup-folder,.dsh-powerup-folder-pop,.dsh-powerup-drag-ghost,.dsh-powerup-drop-line{transition:none}}
`;

      const CSS = `
.dsh-powerup-page{box-sizing:border-box;height:100%;overflow-y:auto;padding:28px 24px 52px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;--pu-accent:var(--dsw-alias-brand-primary)}
.dsh-powerup-page *{box-sizing:border-box}
.dsh-powerup-shell{width:100%;max-width:820px;margin:0 auto}
.dsh-powerup-hero{display:flex;align-items:center;gap:16px;padding:4px 0 24px}
.dsh-powerup-hero-art{flex:none;display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:17px;box-shadow:var(--dsw-elevation-lv2,0 8px 22px rgba(15,23,42,.18))}
.dsh-powerup-hero-copy{min-width:0}
.dsh-powerup-hero h1{margin:0;font-size:22px;line-height:1.25;font-weight:650;letter-spacing:-.01em}
.dsh-powerup-hero p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.5}
.dsh-powerup-card{margin:0 0 14px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-powerup-card-head{display:flex;align-items:flex-start;gap:12px}
.dsh-powerup-card-icon{flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-powerup-card-copy{min-width:0;flex:1 1 auto}
.dsh-powerup-card-copy h2{margin:0;font-size:14px;line-height:1.35;font-weight:650}
.dsh-powerup-card-copy p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.dsh-powerup-switch{flex:none;display:inline-flex;align-items:center;gap:7px;padding:3px 4px 3px 6px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;cursor:pointer;white-space:nowrap}
.dsh-powerup-switch:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dsh-powerup-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-switch-track{position:relative;display:inline-block;flex:none;width:32px;height:17px;border-radius:999px;background:var(--dsw-alias-border-l3);transition:background .14s ease}
.dsh-powerup-switch-thumb{position:absolute;top:2px;left:2px;display:block;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-bg-layer-1));box-shadow:0 1px 2px rgba(15,23,42,.18);transition:transform .14s ease,background .14s ease}
.dsh-powerup-switch[aria-checked=true]{color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-powerup-switch[aria-checked=true] .dsh-powerup-switch-track{background:var(--dsw-alias-brand-primary)}
.dsh-powerup-switch[aria-checked=true] .dsh-powerup-switch-thumb{background:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1));transform:translateX(15px)}
.dsh-powerup-section-title{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.dsh-powerup-settings{display:flex;flex-direction:column;gap:0;margin-top:12px}
.dsh-powerup-setting{display:flex;align-items:center;gap:14px;padding:9px 0;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-setting:first-child{border-top:0;padding-top:4px}
.dsh-powerup-setting-copy{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0}
.dsh-powerup-setting-label{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px}
.dsh-powerup-setting-hint{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.dsh-powerup-setting .dsh-powerup-switch{margin-left:auto}
.dsh-powerup-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0;padding:0;list-style:none}
.dsh-powerup-action{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:7px 8px;border-radius:8px}
.dsh-powerup-action-icon{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-top:1px;color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-action-copy{min-width:0}
.dsh-powerup-action-name{display:block;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-powerup-action-hint{display:block;margin-top:1px;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dsh-powerup-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
.dsh-powerup-step{display:flex;align-items:flex-start;gap:9px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.dsh-powerup-step-num{flex:none;display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;margin-top:1px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}
.dsh-powerup-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 2px 0;color:var(--dsw-alias-label-caption);font-size:10.5px;line-height:1.5}
.dsh-powerup-dot{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-label-caption);opacity:.6}
.dsh-powerup-menu{position:fixed;z-index:1000;min-width:232px;max-width:300px;max-height:min(70vh,430px);overflow-y:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-elevation-prominent,0 16px 40px rgba(15,23,42,.24),0 2px 8px rgba(15,23,42,.1));color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.4;pointer-events:auto;outline:none;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-menu-head{display:flex;align-items:center;gap:6px;padding:5px 7px 6px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:600;letter-spacing:.03em}
.dsh-powerup-menu-head-icon{display:flex;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-menu-kind{margin-left:auto;max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-weight:500;line-height:16px}
.dsh-powerup-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1)}
.dsh-powerup-item{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:30px;text-align:left;cursor:pointer;white-space:nowrap}
.dsh-powerup-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dsh-powerup-item:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-powerup-item:disabled{color:var(--dsw-alias-label-tertiary);opacity:.55;cursor:default}
.dsh-powerup-item-icon{flex:none;display:flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-item:hover:not(:disabled) .dsh-powerup-item-icon{color:var(--dsw-alias-label-primary)}
.dsh-powerup-item-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-item-hint{flex:none;color:var(--dsw-alias-label-caption);font-size:10.5px}
.dsh-powerup-menu-foot{display:flex;align-items:center;gap:6px;margin-top:4px;padding:5px 7px 3px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:10px;line-height:1.4}
.dsh-powerup-menu-foot-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace)}
.dsh-powerup-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:1001;max-width:min(440px,calc(100vw - 32px));padding:7px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-lv2,0 8px 24px rgba(15,23,42,.18));font-size:12px;line-height:1.45;pointer-events:none;animation:dsh-powerup-toast-in .14s ease-out}
@keyframes dsh-powerup-toast-in{from{opacity:0;transform:translate(-50%,5px)}to{opacity:1;transform:translate(-50%,0)}}
.dsh-powerup-jobstop{position:fixed;z-index:1400;box-sizing:border-box;display:flex;flex-direction:column;padding:0 0 16px;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;pointer-events:auto;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);animation:dsh-powerup-jobstop-in .16s ease-out}
@keyframes dsh-powerup-jobstop-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.dsh-powerup-jobstop-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:18px 12px 6px 20px}
.dsh-powerup-jobstop-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-powerup-jobstop-title{color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-weight:500}
.dsh-powerup-jobstop-subtitle{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-powerup-jobstop-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-4px -2px 0 0;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.dsh-powerup-jobstop-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-jobstop-label{display:flex;align-items:center;gap:6px;min-width:0;margin:6px 20px 0;font-size:11.5px;line-height:18px}
.dsh-powerup-jobstop-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.dsh-powerup-jobstop-kind{flex:none;padding:0 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:10.5px;line-height:16px}
.dsh-powerup-jobstop-label-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11.5px;line-height:18px}
.dsh-powerup-jobstop-body{display:flex;flex-direction:column;gap:12px;margin-top:12px;padding:0 20px}
.dsh-powerup-jobstop-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-powerup-jobstop-field-label{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:17px}
.dsh-powerup-jobstop-input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;outline:none;transition:border-color .14s ease}
.dsh-powerup-jobstop-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-powerup-jobstop-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-jobstop-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-powerup-jobstop-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-powerup-jobstop-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:17px;overflow-wrap:anywhere}
.dsh-powerup-jobstop-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 20px 0}
.dsh-powerup-jobstop-cancel{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-powerup-jobstop-cancel:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-jobstop-cancel:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-jobstop-confirm{height:36px;padding:0 14px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;transition:background .14s ease}
.dsh-powerup-jobstop-confirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}
.dsh-powerup-jobstop-confirm:disabled,.dsh-powerup-jobstop-cancel:disabled,.dsh-powerup-jobstop-close:disabled{opacity:.4;cursor:not-allowed}
.dsh-powerup-jobstop-cancel:focus-visible,.dsh-powerup-jobstop-confirm:focus-visible,.dsh-powerup-jobstop-close:focus-visible,.dsh-powerup-jobstop-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
@media (prefers-reduced-motion:reduce){.dsh-powerup-jobstop{animation:none}}
.dsh-powerup-update-button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}
.dsh-powerup-update-button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}
.dsh-powerup-restart-tag{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 6px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent);border-radius:999px;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:10px;line-height:16px;white-space:nowrap}
.dsh-powerup-restart-bar{display:flex;flex:none;align-items:center;gap:8px;margin-left:8px}
.dsh-powerup-restart-count{color:var(--dsw-alias-state-warn-label);font-size:11.5px;line-height:18px;white-space:nowrap}
.dsh-powerup-restart-count[data-state=idle]{color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-restart-action{height:26px;padding:0 10px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 36%,transparent);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font:inherit;font-size:11.5px;line-height:18px;cursor:pointer}
.dsh-powerup-restart-action:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.dsh-powerup-restart-action[data-state=idle]{border-color:var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-powerup-restart-action[data-state=idle]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-default{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}
.dsh-powerup-update-default:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-warn-label)}
.dsh-powerup-update-default[aria-pressed=true]{color:var(--dsw-alias-state-warn-label)}
.dsh-powerup-update-default-tag{flex:none;padding:0 6px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent);border-radius:999px;color:var(--dsw-alias-state-warn-label);font-size:10px;line-height:16px;white-space:nowrap}
.dsh-powerup-update-mask{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur,blur(3px));pointer-events:auto;animation:dsh-powerup-update-fade .16s ease-out}
@keyframes dsh-powerup-update-fade{from{opacity:0}to{opacity:1}}
.dsh-powerup-update-dialog{box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:min(560px,100%);max-height:min(760px,calc(100vh - 48px));max-height:min(760px,calc(100dvh - 48px));border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden;animation:dsh-powerup-update-rise .18s cubic-bezier(.2,.8,.3,1)}
@keyframes dsh-powerup-update-rise{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-powerup-update-mask,.dsh-powerup-update-dialog{animation:none}}
.dsh-powerup-update-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 14px 12px 24px}
.dsh-powerup-update-heading{flex:1 1 auto;min-width:0}
.dsh-powerup-update-heading h2{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-heading p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-update-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.dsh-powerup-update-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-body{display:flex;flex-direction:column;gap:20px;min-height:0;margin-top:8px;padding:0 24px 4px;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-update-field{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-powerup-update-label{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-weight:500}
.dsh-powerup-update-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsh-powerup-update-name{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11.5px;line-height:18px;overflow-wrap:anywhere}
.dsh-powerup-update-summary{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-powerup-update-list-state{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-powerup-update-now{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-powerup-update-now .label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-powerup-update-now code{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11.5px;line-height:20px;font-variant-numeric:tabular-nums}
.dsh-powerup-update-row{display:flex;align-items:stretch;gap:8px}
.dsh-powerup-update-input{flex:1 1 auto;min-width:0;height:38px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none;transition:border-color .14s ease,box-shadow .14s ease}
.dsh-powerup-update-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-powerup-update-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-toggle{flex:none;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer;transition:background .14s ease,border-color .14s ease,color .14s ease}
.dsh-powerup-update-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-toggle[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-toggle .chevron{display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
.dsh-powerup-update-toggle[aria-expanded=true] .chevron{transform:rotate(180deg);color:var(--dsw-alias-label-secondary)}
.dsh-powerup-update-list{box-sizing:border-box;display:flex;flex-direction:column;max-height:240px;overflow-x:hidden;overflow-y:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-update-popover{position:fixed;z-index:1300;box-sizing:border-box;overflow-x:hidden;overflow-y:auto;pointer-events:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-update-popover.dsh-powerup-update-list{border-radius:var(--dsw-radius-lg,10px)}
.dsh-powerup-update-popover.dsh-powerup-update-select-menu{display:flex;flex-direction:column;padding:4px}
.dsh-powerup-update-list-head{box-sizing:border-box;position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-powerup-update-version{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 12px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
.dsh-powerup-update-version>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-update-version:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-version[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-update-version[data-current]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-trailing{display:inline-flex;flex:none;align-items:center;gap:8px;margin-left:auto;white-space:nowrap}
.dsh-powerup-update-tag{padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;white-space:nowrap}
.dsh-powerup-update-tag.is-current{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-check{display:inline-flex;color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-status{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-powerup-update-spinner{flex:none;width:14px;height:14px;border:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:dsh-powerup-spin .8s linear infinite}
@keyframes dsh-powerup-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsh-powerup-update-spinner{animation:none}}
.dsh-powerup-update-log{margin:0;max-height:160px;overflow:auto;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-powerup-update-notice{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:.5px solid transparent;border-radius:var(--dsw-radius-md,8px);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-notice svg{flex:none;margin-top:2px}
.dsh-powerup-update-notice span{min-width:0;overflow-wrap:anywhere}
.dsh-powerup-update-notice-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-powerup-update-notice-title{font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dsh-powerup-update-notice.error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dsh-powerup-update-notice.error svg{color:var(--dsw-alias-state-error-primary)}
.dsh-powerup-update-notice.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent);background:var(--dsw-alias-state-warn-tertiary)}
.dsh-powerup-update-notice.warn svg{color:var(--dsw-alias-state-warn-primary)}
.dsh-powerup-update-notice.success{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.dsh-powerup-update-notice.success svg{color:var(--dsw-alias-state-success-primary)}
.dsh-powerup-update-registry{display:flex;flex-direction:column;gap:8px}
.dsh-powerup-update-select{position:relative}
.dsh-powerup-update-select-trigger{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;height:38px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease}
.dsh-powerup-update-select-trigger:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-update-select-trigger[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-select-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-update-select-host{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-powerup-update-select-trigger .chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
.dsh-powerup-update-select-trigger[aria-expanded=true] .chevron{transform:rotate(180deg)}
.dsh-powerup-update-select-menu{box-sizing:border-box;display:flex;flex-direction:column;padding:4px;overflow-x:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dsh-powerup-update-option{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;width:100%;min-width:0;padding:8px 10px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsh-powerup-update-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-option[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-update-option-copy{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0}
.dsh-powerup-update-option-title{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px}
.dsh-powerup-update-option-host{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.dsh-powerup-update-option .dsh-powerup-update-check{flex:none;margin-top:2px}
.dsh-powerup-update-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;padding:16px 24px 22px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-update-primary{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;line-height:22px;cursor:pointer;transition:background .14s ease}
.dsh-powerup-update-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsh-powerup-update-primary:disabled{opacity:.4;cursor:not-allowed}
.dsh-powerup-update-ghost{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-powerup-update-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-ghost:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-update-quick{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 13px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,transparent);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font:inherit;font-size:13.5px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .14s ease,border-color .14s ease}
.dsh-powerup-update-quick:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}
.dsh-powerup-update-quick:disabled{opacity:.45;cursor:not-allowed}
.dsh-powerup-update-quick-note{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 26%,transparent);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-state-warn-tertiary)}
.dsh-powerup-update-quick-note-title{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:17px;font-weight:500}
.dsh-powerup-update-quick-note .dsh-powerup-update-note{color:var(--dsw-alias-label-secondary)}
.dsh-powerup-update-close:focus-visible,.dsh-powerup-update-toggle:focus-visible,.dsh-powerup-update-version:focus-visible,.dsh-powerup-update-select-trigger:focus-visible,.dsh-powerup-update-option:focus-visible,.dsh-powerup-update-primary:focus-visible,.dsh-powerup-update-ghost:focus-visible,.dsh-powerup-update-quick:focus-visible,.dsh-powerup-update-button:focus-visible,.dsh-powerup-restart-action:focus-visible,.dsh-powerup-update-default:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
@media (max-width:680px){.dsh-powerup-page{padding:20px 16px 42px}.dsh-powerup-actions{grid-template-columns:minmax(0,1fr)}.dsh-powerup-hero-art{width:54px;height:54px}.dsh-powerup-hero h1{font-size:19px}.dsh-powerup-card-head{flex-wrap:wrap}.dsh-powerup-switch{margin-left:auto}.dsh-powerup-update-mask{padding:12px}.dsh-powerup-update-dialog{max-height:calc(100dvh - 24px)}.dsh-powerup-update-head{padding:18px 12px 10px 18px}.dsh-powerup-update-body{padding:0 18px 4px}.dsh-powerup-update-foot{padding:14px 18px 18px}}
`;

      function installStyles(ctx) {
        try {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-powerup', '');
          style.textContent = CSS + '\n' + LAUNCHER_CSS;
          document.head.appendChild(style);
          ctx.effect(() => () => style.remove(), 'dsh-powerup: styles');
        } catch (error) {
          console.warn('[dsh-powerup] style injection failed:', error?.message ?? error);
        }
      }

      // ------------------------------------------------------------------
      // Clipboard + trajectory helpers
      // ------------------------------------------------------------------
      function shortId(id) {
        return typeof id === 'string' && id.length > 0 ? id.slice(0, 8) : '—';
      }

      async function copyText(text) {
        if (typeof text !== 'string' || text === '') throw new Error('empty');
        try {
          if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch {
          /* Fall through to the textarea path. */
        }
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        area.style.pointerEvents = 'none';
        document.body.appendChild(area);
        try {
          area.select();
          const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
          if (!ok) throw new Error('copy-command-failed');
          return true;
        } finally {
          area.remove();
        }
      }

      /** Decode the ledger row identity into the trajectory record id parts. */
      function rowKeyParts(row) {
        const raw = row.getAttribute('data-trajectory-row-key');
        if (typeof raw !== 'string' || raw === '') return [];
        try {
          return decodeURIComponent(raw).split('\u0000');
        } catch {
          return [];
        }
      }

      /**
       * The trajectory record id behind a ledger row. The DOM attribute is the
       * URI-encoded record id; a folded summary row appends a raw
       * `\0summary\0<kind>` suffix that is not part of the record identity.
       */
      function rowRecordId(row) {
        const raw = row.getAttribute('data-trajectory-row-key');
        if (typeof raw !== 'string' || raw === '') return '';
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          /* Keep the literal attribute. */
        }
        const summaryCut = decoded.indexOf('\u0000summary\u0000');
        return summaryCut === -1 ? decoded : decoded.slice(0, summaryCut);
      }

      /**
       * The step id a step reference carries: assistant rows resolve to their
       * turn/step, tool rows to their call id, raw-event rows to their seq.
       * Synthetic index rows have no stable identity and yield `''`.
       */
      function rowStepId(row) {
        const recordId = rowRecordId(row);
        if (recordId === '') return '';
        const parts = recordId.split('\u0000');
        if (parts.length < 3) return '';
        if (parts[0] === 'assistant') {
          // `assistant\0T\0S` today; `assistant\0turn\0T\0step\0S` in older logs.
          const turn = Number(parts[1] === 'turn' ? parts[2] : parts[1]);
          const step = Number(parts[1] === 'turn' ? parts[4] : parts[2]);
          if (Number.isInteger(turn) && Number.isInteger(step) && turn >= 0 && step >= 0) {
            return `turn.${turn}.step.${step}`;
          }
          return '';
        }
        if (parts[1] === 'call' && parts[2] !== '') return `call.${encodeURIComponent(parts[2])}`;
        if (parts[1] === 'seq' && Number.isInteger(Number(parts[2]))) return `seq.${Number(parts[2])}`;
        return '';
      }

      /** The reference the Host step reader resolves: session id + step id. */
      function rowStepReference(sessionId, stepId) {
        if (typeof sessionId !== 'string' || sessionId === '' || stepId === '') return '';
        return `${STEP_REF_PREFIX}${sessionId}/${stepId}`;
      }

      /** The full visible content of one ledger row. */
      function rowText(row) {
        const cell = row.querySelector('td:nth-child(2)');
        if (cell === null) return '';
        const titled = cell.querySelector('span[title]');
        const full = titled?.getAttribute('title');
        if (typeof full === 'string' && full.trim() !== '') return full.trim();
        return (cell.innerText || cell.textContent || '').trim();
      }

      function rowKind(row) {
        return row.getAttribute('data-kind') || '';
      }

      function rowKindLabel(row) {
        const label = row.querySelector('[data-role-kind]')?.textContent?.trim();
        return label || '';
      }

      function markdownQuote(row, t) {
        const text = rowText(row);
        if (text === '') return '';
        const kind = rowKindLabel(row) || t('menu.record');
        const quoted = text.split('\n').map((line) => `> ${line}`).join('\n');
        return `> **${kind}**\n${quoted}`;
      }

      function containsCallId(value, callId, seen, depth) {
        if (depth > 9 || value === null || typeof value !== 'object') return false;
        if (seen.has(value)) return false;
        seen.add(value);
        if (value.callId === callId) return true;
        for (const key of Object.keys(value)) {
          if (key === 'schema' || key === 'result' || key === 'output') continue;
          if (containsCallId(value[key], callId, seen, depth + 1)) return true;
        }
        return false;
      }

      function findCallSeq(nodes, callId) {
        if (!Array.isArray(nodes) || typeof callId !== 'string' || callId === '') return null;
        for (const node of nodes) {
          if (node === null || typeof node !== 'object') continue;
          if (containsCallId(node, callId, new Set(), 0) && Number.isFinite(node.seq)) return node.seq;
        }
        return null;
      }

      /**
       * Resolve the inclusive event seq a row can be forked at. The row key is
       * the trajectory package's own stable identity: `kind\0seq\0N`,
       * `kind\0call\0ID`, or `assistant\0turn\0T\0step\0S`.
       */
      function resolveForkSeq(row, snapshot) {
        const parts = rowKeyParts(row);
        if (parts.length === 0) return null;
        // Assistant records use the "assistant", turn, step record id (see
        // ui-trajectory's trajectoryRecordId); older/other rows use the
        // "kind", "seq", N or "kind", "call", ID forms.
        if (parts[0] === 'assistant' && parts.length >= 3) {
          const turn = Number(parts[1]);
          const step = Number(parts[2]);
          const requests = Array.isArray(snapshot?.requests) ? snapshot.requests : [];
          const request = requests.find((candidate) =>
            candidate !== null
            && candidate.purpose === 'assistant'
            && candidate.turn === turn
            && candidate.step === step);
          if (request === undefined) return null;
          return Number.isFinite(request.resultSeq) ? request.resultSeq : (Number.isFinite(request.startSeq) ? request.startSeq : null);
        }
        if (parts[1] === 'seq') {
          const seq = Number(parts[2]);
          return Number.isFinite(seq) ? seq : null;
        }
        if (parts[1] === 'call') {
          return findCallSeq(snapshot?.eventNodes, parts[2]);
        }
        return null;
      }

      function jsonSafe(value, seen) {
        if (value === null || typeof value !== 'object') {
          return typeof value === 'bigint' ? String(value) : value;
        }
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
        if (value instanceof Map) {
          const out = {};
          for (const [key, entry] of value.entries()) out[String(key)] = jsonSafe(entry, seen);
          return out;
        }
        if (value instanceof Set) return [...value].map((item) => jsonSafe(item, seen));
        const out = {};
        for (const key of Object.keys(value)) {
          const entry = value[key];
          if (typeof entry === 'function') continue;
          out[key] = jsonSafe(entry, seen);
        }
        return out;
      }

      function downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function insertIntoComposer(value) {
        const actions = bridge.inputActions;
        if (actions === null || actions === undefined) return false;
        if (typeof actions.captureInsertion !== 'function' || typeof actions.insertText !== 'function') return false;
        try {
          const span = actions.captureInsertion();
          if (actions.insertText(value, span) === true) {
            actions.persistDraft?.();
            return true;
          }
        } catch {
          /* Fall back to the clipboard. */
        }
        return false;
      }

      // ------------------------------------------------------------------
      // Overlay: context menu + toast
      // ------------------------------------------------------------------
      function PowerUpOverlay({ ctx }) {
        const settings = useSettings();
        const [menu, setMenu] = useState(null);
        const [toast, setToast] = useState(null);
        const [position, setPosition] = useState(null);
        const menuRef = useRef(null);
        const toastTimer = useRef(null);

        const t = useCallback((key, params) => translateCurrent(key, params), []);

        const notify = useCallback((message) => {
          setToast(message);
          if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => {
            toastTimer.current = null;
            setToast(null);
          }, 2200);
        }, []);

        useEffect(() => () => {
          if (toastTimer.current !== null) {
            window.clearTimeout(toastTimer.current);
            toastTimer.current = null;
          }
        }, []);

        const close = useCallback(() => {
          setMenu(null);
          setPosition(null);
        }, []);

        const runAction = useCallback(async (item) => {
          if (item === null || item === undefined || item.disabled === true) return;
          try {
            await item.run();
          } catch (error) {
            notify(format(t('toast.actionFailed'), { message: error?.message ?? String(error) }));
          }
        }, [notify, t]);

        useEffect(() => {
          if (!settings.enabled) {
            close();
            return undefined;
          }
          const onContextMenu = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const pane = target.closest('[data-trajectory-scroll]');
            if (pane === null) return;
            if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], a')) return;
            const row = target.closest('tr[data-trajectory-row-key]');
            event.preventDefault();
            event.stopPropagation();
            const snapshot = bridge.trajectory;
            const sessionId = bridge.sessionId;
            const items = row !== null ? buildRowItems(row, snapshot, t, sessionId, ctx, notify) : buildSessionItems(snapshot, sessionId, t, ctx, notify);
            let x = event.clientX;
            let y = event.clientY;
            if (x === 0 && y === 0) {
              const anchor = row ?? pane;
              const rect = anchor.getBoundingClientRect();
              x = rect.left + Math.min(24, rect.width / 2);
              y = rect.top + Math.min(24, rect.height / 2);
            }
            setPosition({ x, y });
            setMenu({
              x,
              y,
              row,
              sessionId,
              title: row !== null ? rowKindLabel(row) || t('menu.record') : t('menu.blank'),
              items,
            });
          };
          const onPointerDown = (event) => {
            if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return;
            close();
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') close();
          };
          const onScroll = (event) => {
            if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) return;
            close();
          };
          const onResize = () => close();
          document.addEventListener('contextmenu', onContextMenu, true);
          document.addEventListener('pointerdown', onPointerDown, true);
          document.addEventListener('keydown', onKeyDown, true);
          document.addEventListener('scroll', onScroll, true);
          window.addEventListener('resize', onResize);
          window.addEventListener('blur', onResize);
          return () => {
            document.removeEventListener('contextmenu', onContextMenu, true);
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('blur', onResize);
          };
        }, [settings.enabled, close, t, ctx, notify]);

        useLayoutEffect(() => {
          if (menu === null || menuRef.current === null) return;
          const rect = menuRef.current.getBoundingClientRect();
          const maxX = Math.max(MENU_GAP, window.innerWidth - rect.width - MENU_GAP);
          const maxY = Math.max(MENU_GAP, window.innerHeight - rect.height - MENU_GAP);
          const x = Math.min(Math.max(MENU_GAP, menu.x), maxX);
          const y = Math.min(Math.max(MENU_GAP, menu.y), maxY);
          if (position === null || position.x !== x || position.y !== y) setPosition({ x, y });
        }, [menu, position]);

        useEffect(() => {
          if (menu === null || menuRef.current === null) return;
          const first = menuRef.current.querySelector('[role="menuitem"]:not(:disabled)');
          first?.focus?.();
        }, [menu]);

        if (menu === null) {
          return toast === null ? null : h('div', { className: 'dsh-powerup-toast', role: 'status' }, toast);
        }

        const left = position?.x ?? menu.x;
        const top = position?.y ?? menu.y;
        return h(React.Fragment, null,
          h('div', {
            className: 'dsh-powerup-menu',
            role: 'menu',
            'aria-label': t('menu.title'),
            ref: menuRef,
            style: { left, top },
            onKeyDown: (event) => {
              const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])];
              if (items.length === 0) return;
              const active = document.activeElement;
              const index = items.indexOf(active);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                items[(index + 1) % items.length]?.focus?.();
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                items[index <= 0 ? items.length - 1 : index - 1]?.focus?.();
              } else if (event.key === 'Home') {
                event.preventDefault();
                items[0]?.focus?.();
              } else if (event.key === 'End') {
                event.preventDefault();
                items[items.length - 1]?.focus?.();
              } else if (event.key === 'Tab') {
                close();
              }
            },
          },
          h('div', { className: 'dsh-powerup-menu-head' },
            h('span', { className: 'dsh-powerup-menu-head-icon' }, h(PowerUpLineIcon, { size: 13 })),
            h('span', null, t('menu.title')),
            h('span', { className: 'dsh-powerup-menu-kind', title: menu.title }, menu.title),
          ),
          ...menu.items.map((item, index) => item.type === 'separator'
            ? h('div', { key: `sep-${index}`, className: 'dsh-powerup-menu-sep', role: 'separator' })
            : h('button', {
              key: item.id,
              type: 'button',
              role: 'menuitem',
              className: 'dsh-powerup-item',
              disabled: item.disabled === true,
              title: item.title,
              onClick: () => {
                if (item.disabled === true) return;
                close();
                runAction(item);
              },
            },
            h('span', { className: 'dsh-powerup-item-icon' }, item.icon),
            h('span', { className: 'dsh-powerup-item-text' }, item.label),
            item.hint ? h('span', { className: 'dsh-powerup-item-hint' }, item.hint) : null,
            )),
          h('div', { className: 'dsh-powerup-menu-foot' },
            h('span', null, 'Power-Up'),
            h('span', { className: 'dsh-powerup-dot' }),
            h('span', { className: 'dsh-powerup-menu-foot-id', title: menu.sessionId ?? '' }, shortId(menu.sessionId)),
          ),
          toast === null ? null : h('div', { className: 'dsh-powerup-toast', role: 'status' }, toast),
        ),
      );
      }

      // ------------------------------------------------------------------
      // Plugin update: entry button on the built-in Plugins page + dialog
      // ------------------------------------------------------------------
      const PLUGIN_REGISTRY_MEMORY_KEY = 'dsh.plugin-manager.install-registry';
      const POWERUP_REGISTRY_KEY = 'dsh-powerup:update-registry:v1';
      const PENDING_RESTART_KEY = 'dsh-powerup:pending-restart:v1';
      const UPDATE_API = '/dsh-powerup/api/restart';
      const AUDIT_API = '/dsh-powerup/api/audit';
      const SELF_UPDATE_API = '/dsh-powerup/api/self-update';
      const JOB_KILL_API = '/dsh-powerup/api/job-kill';
      /** Character cap shared by the stop dialog and the Host normalizer. */
      const JOB_STOP_REASON_MAX = 200;
      const OFFICIAL_REGISTRY = 'https://registry.npmjs.org/';
      const REGISTRY_HOSTS = new Map([
        ['registry.npmjs.org', 'update.registryDefault'],
        ['registry.npmmirror.com', 'update.registryMirror'],
      ]);

      /** The npm registry host of a URL, or the URL as written. */
      function registryHost(url) {
        try {
          return new URL(url).host;
        } catch {
          return String(url ?? '');
        }
      }

      /** A registry URL with one trailing slash, for building metadata URLs. */
      function normalizeRegistry(url) {
        const value = String(url ?? '').trim();
        return value.endsWith('/') ? value : `${value}/`;
      }

      /** A registry value the Host compares as a string; null means "pnpm's own". */
      function registryValue(choice) {
        return choice === null || choice === undefined ? null : choice.value;
      }

      /** The concrete URL to read metadata from. */
      function registryFetchUrl(choice) {
        return normalizeRegistry(choice?.url ?? OFFICIAL_REGISTRY);
      }

      /**
       * Read the registry the built-in Add plugin dialog remembers. The store
       * persists its snapshot under this localStorage key as plain JSON.
       * @returns {{ kind: string, registry?: string | null, url?: string } | null}
       */
      function readRememberedRegistry() {
        try {
          const raw = localStorage.getItem(PLUGIN_REGISTRY_MEMORY_KEY);
          if (typeof raw !== 'string' || raw === '') return null;
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return null;
          return parsed;
        } catch {
          return null;
        }
      }

      /**
       * Read the registry the user starred as Power-Up's list default.
       * @returns {{ key?: string, value?: string | null, url?: string, label?: string, hint?: string } | null}
       */
      function readDefaultRegistry() {
        try {
          const raw = localStorage.getItem(POWERUP_REGISTRY_KEY);
          if (typeof raw !== 'string' || raw === '') return null;
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return null;
          return parsed;
        } catch {
          return null;
        }
      }

      /**
       * Persist the registry the update list should start from.
       * @param {{ key: string, value: string | null, url: string, label: string, hint: string }} choice
       */
      function writeDefaultRegistry(choice) {
        try {
          localStorage.setItem(POWERUP_REGISTRY_KEY, JSON.stringify({
            key: choice.key,
            value: choice.value,
            url: choice.url,
            label: choice.label,
            hint: choice.hint,
          }));
        } catch {
          /* A full or private store keeps the in-memory selection. */
        }
      }

      /** Pending-restart records for this browser session (cleared by a real restart). */
      function readPendingRestarts() {
        try {
          const raw = sessionStorage.getItem(PENDING_RESTART_KEY);
          if (typeof raw !== 'string' || raw === '') return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.name === 'string') : [];
        } catch {
          return [];
        }
      }

      /**
       * @param {Array<{ name: string, version?: string, reason?: string, at?: number }>} entries
       */
      function writePendingRestarts(entries) {
        try {
          sessionStorage.setItem(PENDING_RESTART_KEY, JSON.stringify(entries));
        } catch {
          /* The badge is a hint; failing to persist it must not break updates. */
        }
      }

      /**
       * The registry choices the update dialog offers: the Host's configured
       * default (with the URL pnpm actually names), each configured fallback,
       * the built-in Add dialog's remembered custom address, and Power-Up's
       * own starred default.
       * @param {{ registry: string | null, fallbackRegistries: string[], resolved: string | null } | null} registries
       * @param {object | null} remembered
       * @param {object | null} powerupDefault
       * @param {(key: string) => string} t
       * @returns {Array<{ key: string, label: string, hint: string, value: string | null, url: string }>}
       */
      function buildRegistryChoices(registries, remembered, powerupDefault, t) {
        const choices = [];
        const seen = new Set();
        const add = (choice) => {
          const key = choice.value === null ? 'default' : normalizeRegistry(choice.value);
          if (seen.has(key)) return;
          seen.add(key);
          choices.push({ ...choice, key });
        };
        const fallbacks = Array.isArray(registries?.fallbackRegistries) ? registries.fallbackRegistries : [];
        const resolved = typeof registries?.resolved === 'string' ? registries.resolved : OFFICIAL_REGISTRY;
        add({
          label: t('update.registryDefault'),
          hint: registryHost(resolved),
          value: registries?.registry ?? null,
          url: normalizeRegistry(registries?.registry ?? resolved),
        });
        for (const fallback of fallbacks) {
          if (typeof fallback !== 'string' || fallback.trim() === '') continue;
          const host = registryHost(fallback);
          add({
            label: REGISTRY_HOSTS.has(host) ? t(REGISTRY_HOSTS.get(host)) : host,
            hint: host,
            value: fallback,
            url: normalizeRegistry(fallback),
          });
        }
        if (remembered !== null && remembered.kind === 'custom' && typeof remembered.url === 'string' && remembered.url.trim() !== '') {
          add({
            label: t('update.registryCustom'),
            hint: registryHost(remembered.url),
            value: remembered.url.trim(),
            url: normalizeRegistry(remembered.url),
          });
        }
        const rememberedOffered = remembered !== null
          && remembered.kind === 'offered'
          && typeof remembered.registry === 'string'
          && remembered.registry.trim() !== ''
          ? remembered.registry
          : null;
        if (rememberedOffered !== null) {
          add({
            label: t('update.registryCustom'),
            hint: registryHost(rememberedOffered),
            value: rememberedOffered.trim(),
            url: normalizeRegistry(rememberedOffered),
          });
        }
        if (powerupDefault !== null && typeof powerupDefault === 'object') {
          const value = powerupDefault.value === undefined ? null : powerupDefault.value;
          const url = powerupDefault.url ?? value ?? OFFICIAL_REGISTRY;
          add({
            label: typeof powerupDefault.label === 'string'
              ? powerupDefault.label
              : (value === null ? t('update.registryDefault') : t('update.registryCustom')),
            hint: typeof powerupDefault.hint === 'string' ? powerupDefault.hint : registryHost(url),
            value,
            url: normalizeRegistry(url),
          });
        }
        if (choices.length === 0) {
          add({
            label: t('update.registryDefault'),
            hint: registryHost(OFFICIAL_REGISTRY),
            value: null,
            url: OFFICIAL_REGISTRY,
          });
        }
        return choices;
      }

      /**
       * Find the offered registry matching a persisted Power-Up default.
       * @param {Array<{ key: string, value: string | null, url: string }>} choices
       * @param {{ key?: string, value?: string | null, url?: string } | null} stored
       * @returns {object | undefined}
       */
      function matchStoredChoice(choices, stored) {
        if (stored === null || typeof stored !== 'object') return undefined;
        if (typeof stored.key === 'string') {
          const byKey = choices.find((choice) => choice.key === stored.key);
          if (byKey !== undefined) return byKey;
        }
        const value = stored.value === undefined ? null : stored.value;
        if (value === null) return choices.find((choice) => choice.value === null);
        const wanted = normalizeRegistry(value ?? stored.url ?? OFFICIAL_REGISTRY);
        return choices.find((choice) => choice.value !== null && normalizeRegistry(choice.value) === wanted)
          ?? choices.find((choice) => normalizeRegistry(choice.url) === wanted);
      }

      /**
       * Choose the registry the update list starts from: Power-Up's starred
       * default, then what the Add dialog remembered, then the configured one.
       * @param {Array<{ key: string, value: string | null, url: string }>} choices
       * @param {object | null} remembered
       * @param {object | null} powerupDefault
       * @returns {object}
       */
      function pickRegistryChoice(choices, remembered, powerupDefault) {
        const starred = matchStoredChoice(choices, powerupDefault);
        if (starred !== undefined) return starred;
        if (remembered !== null && typeof remembered === 'object') {
          if (remembered.kind === 'offered') {
            const wanted = remembered.registry === null ? null : normalizeRegistry(remembered.registry);
            const match = choices.find((choice) => (wanted === null
              ? choice.value === null
              : choice.value !== null && normalizeRegistry(choice.value) === wanted));
            if (match !== undefined) return match;
          }
          if (remembered.kind === 'custom' && typeof remembered.url === 'string') {
            const wanted = normalizeRegistry(remembered.url);
            const match = choices.find((choice) => normalizeRegistry(choice.value ?? choice.url) === wanted);
            if (match !== undefined) return match;
          }
        }
        return choices[0];
      }

      /** The lookup order: the chosen registry first, then the other offered URLs. */
      function lookupRegistries(choices, chosen) {
        const ordered = [];
        const seen = new Set();
        for (const choice of [chosen, ...choices]) {
          if (choice === null || choice === undefined) continue;
          const url = registryFetchUrl(choice);
          if (seen.has(url)) continue;
          seen.add(url);
          ordered.push(choice);
        }
        return ordered;
      }

      /** Split a version into its release and prerelease parts. */
      function versionParts(version) {
        const text = String(version ?? '').trim().replace(/^v/u, '');
        const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(text);
        if (match === null) return null;
        return {
          release: match[1].split('.').map((part) => Number.parseInt(part, 10)),
          prerelease: match[2] === undefined ? null : match[2].split('.'),
        };
      }

      /** Semver-ish descending comparator that keeps unparseable versions last. */
      function compareVersionsDesc(a, b) {
        const left = versionParts(a);
        const right = versionParts(b);
        if (left === null && right === null) return String(b).localeCompare(String(a));
        if (left === null) return 1;
        if (right === null) return -1;
        for (let index = 0; index < Math.max(left.release.length, right.release.length); index += 1) {
          const diff = (right.release[index] ?? 0) - (left.release[index] ?? 0);
          if (diff !== 0) return diff;
        }
        if (left.prerelease === null && right.prerelease === null) return 0;
        if (left.prerelease === null) return -1;
        if (right.prerelease === null) return 1;
        for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
          const l = left.prerelease[index];
          const r = right.prerelease[index];
          if (l === undefined) return 1;
          if (r === undefined) return -1;
          const lNumber = /^\d+$/u.test(l);
          const rNumber = /^\d+$/u.test(r);
          if (lNumber && rNumber) {
            const diff = Number(r) - Number(l);
            if (diff !== 0) return diff;
          } else if (lNumber !== rNumber) {
            return lNumber ? 1 : -1;
          } else {
            const diff = r.localeCompare(l);
            if (diff !== 0) return diff;
          }
        }
        return 0;
      }

      /** Sorted, deduplicated version keys from registry metadata. */
      function sortVersions(versions) {
        const seen = new Set();
        const list = [];
        for (const version of versions ?? []) {
          if (typeof version !== 'string' || version === '' || seen.has(version)) continue;
          seen.add(version);
          list.push(version);
        }
        return list.sort(compareVersionsDesc);
      }

      /**
       * Which status a version row carries. The installed and the latest
       * version can be the same; that row gets one combined tag instead of two
       * chips sharing the trailing space.
       * @param {string} version
       * @param {string | null | undefined} current
       * @param {string | null | undefined} latest
       * @returns {'current-latest' | 'current' | 'latest' | null}
       */
      function versionTagKind(version, current, latest) {
        const isCurrent = typeof current === 'string' && current !== '' && version === current;
        const isLatest = typeof latest === 'string' && latest !== '' && version === latest;
        if (isCurrent && isLatest) return 'current-latest';
        if (isCurrent) return 'current';
        if (isLatest) return 'latest';
        return null;
      }

      /**
       * Read the versions the registry publishes for one package. The
       * abbreviated metadata keeps the response small; both npm and npmmirror
       * send permissive CORS headers for this GET.
       * @param {string} registry
       * @param {string} name
       * @param {AbortSignal | undefined} signal
       * @returns {Promise<{ versions: string[], latest: string | null }>}
       */
      async function fetchRegistryVersions(registry, name, signal) {
        const encoded = String(name).split('/').map((part) => encodeURIComponent(part).replace(/%40/gu, '@')).join('/');
        const url = `${normalizeRegistry(registry)}${encoded}`;
        let response = await fetch(url, {
          signal,
          headers: { accept: 'application/vnd.npm.install-v1+json' },
        });
        if (!response.ok) {
          // Older or private registries may not serve the abbreviated document.
          response = await fetch(url, { signal });
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const versions = sortVersions(Object.keys(data?.versions ?? {}));
        const latest = typeof data?.['dist-tags']?.latest === 'string' ? data['dist-tags'].latest : null;
        return { versions, latest };
      }

      /**
       * Normalize a typed version. Only concrete versions are accepted: the
       * update removes the old copy before installing, so a typo must be
       * rejected while the plugin is still installed.
       * @param {unknown} value
       * @returns {string} the version without a leading `v`, or '' when invalid.
       */
      function normalizeVersionInput(value) {
        const text = String(value ?? '').trim().replace(/^v/u, '');
        if (text === '' || /\s/u.test(text) || text.includes('@')) return '';
        return /^\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(text) ? text : '';
      }

      /**
       * The version both install paths target: whatever is in the dialog's
       * version input. One-click install reads the same input instead of the
       * registry's newest version, so it can also reinstall or downgrade.
       * @param {{ version?: unknown }} view
       * @returns {string} a concrete version, or '' when the input is invalid.
       */
      function installVersion(view) {
        return normalizeVersionInput(view?.version);
      }

      /** A display title for a bundle, following the page's locale fallback. */
      function packageDisplayTitle(pkg) {
        const title = pkg?.meta?.title;
        if (typeof title === 'string' && title !== '') return title;
        if (title !== null && typeof title === 'object') {
          const locale = String(navigator?.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
          const localized = title[locale] ?? title.en;
          if (typeof localized === 'string' && localized !== '') return localized;
        }
        return String(pkg?.name ?? '');
      }

      /** The human sentence for a refused inspection. */
      function inspectReason(value, t) {
        if (value?.problem === 'already-installed') return t('update.alreadyInstalled');
        if (value?.problem === 'not-found') return t('update.notFound');
        if (value?.problem === 'not-a-bundle') return t('update.notBundle');
        return String(value?.reason ?? t('update.unknown'));
      }

      /** The diagnostic or localized sentence for a failed management operation. */
      function operationReason(value, t) {
        const code = value?.error?.code;
        if (code === 'management-required' || code === 'not-removable') return t('update.notRemovable');
        if (code === 'stop-profile') return t('update.stopProfile');
        if (code === 'not-bundle') return t('update.notBundle');
        if (code === 'already-installed') return t('update.alreadyInstalled');
        const diagnostic = value?.error?.diagnostic ?? value?.packageResult?.output ?? '';
        const text = String(diagnostic).trim();
        return text === '' ? t('update.unknown') : text;
      }

      /** A short error sentence. */
      function errorText(error) {
        return String(error?.message ?? error ?? '').trim();
      }

      /** A unique request id for the install stream. */
      function newRequestId() {
        try {
          if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        } catch {
          /* Fall through to the timestamp form. */
        }
        return `powerup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }

      /**
       * Reinstall the version an update removed. The update removes the old
       * copy before the new spec is inspected, so a refused inspection or a
       * failed install leaves the plugin missing; this puts the old version
       * back with the enabled state it had before the update.
       * @param {{ installBundle: Function }} manager
       * @param {{ name: string, version: string | null | undefined, enabled?: boolean, registry?: string | null }} target
       * @param {(key: string, params?: object) => string} t
       * @returns {Promise<{ version: string }>}
       */
      async function restorePreviousBundle(manager, target, t) {
        const version = typeof target.version === 'string' ? target.version.trim() : '';
        if (version === '') throw new Error(t('update.rollbackUnavailable'));
        const installed = await manager.installBundle(`${target.name}@${version}`, {
          enabled: target.enabled !== false,
          requestId: newRequestId(),
          registry: target.registry ?? null,
        });
        if (!installed.ok) throw new Error(installed.error?.message ?? t('update.unknown'));
        const value = installed.value ?? {};
        if (value.error !== undefined || value.application === 'failed') throw new Error(operationReason(value, t));
        if (value.application === 'cancelled') throw new Error(t('update.cancelled'));
        return {
          version: typeof value.version === 'string' && value.version !== '' ? value.version : version,
          restartRequired: value.application === 'restart-required',
          restartReason: typeof value.restartReason === 'string' ? value.restartReason : '',
        };
      }

      /**
       * Apply a one-click update's post-install defaults: enable the new copy,
       * then restart, without asking. A skipped restart (setting off or an
       * unsupported runtime) ends in `done` with `autoClose`, so the dialog can
       * dismiss itself; enable/restart failures end in `done` without
       * `autoClose` and carry their reason.
       * @param {{
       *   manager: { setBundleEnabled: Function },
       *   name: string,
       *   installedVersion: string,
       *   restartRequired: boolean,
       *   settings: { oneClickEnable?: boolean, oneClickRestart?: boolean },
       *   apply: (patch: object) => void,
       *   isCurrent: () => boolean,
       *   recordPending: (entry: { name: string, version: string, reason: string }) => void,
       *   readRestartCapability: () => Promise<{ supported: boolean, reason: string }>,
       *   requestRestart: () => Promise<void>,
       *   t: (key: string, params?: object) => string,
       * }} input
       * @returns {Promise<void>}
       */
      async function runOneClickUpdate(input) {
        const {
          manager, name, installedVersion, restartRequired, settings,
          apply, isCurrent, recordPending, readRestartCapability, requestRestart, t,
        } = input;
        if (settings.oneClickEnable === false) {
          apply({
            phase: 'done',
            step: null,
            installedVersion,
            enabled: false,
            restartRequired,
            restartSkipped: true,
            skippedEnable: true,
            autoClose: true,
          });
          return;
        }
        apply({ phase: 'working', step: 'enabling', installedVersion, restartRequired });
        let enabledValue;
        try {
          const enabled = await manager.setBundleEnabled(name, true);
          if (!isCurrent()) return;
          if (!enabled.ok) throw new Error(enabled.error?.message ?? t('update.unknown'));
          enabledValue = enabled.value ?? {};
          if (enabledValue.error !== undefined || enabledValue.application === 'failed') throw new Error(operationReason(enabledValue, t));
          if (enabledValue.application === 'cancelled') throw new Error(t('update.cancelled'));
        } catch (error) {
          apply({
            phase: 'done',
            step: null,
            installedVersion,
            enabled: false,
            enableError: errorText(error) || t('update.unknown'),
            autoClose: false,
          });
          return;
        }
        if (restartRequired || enabledValue.application === 'restart-required') {
          recordPending({
            name,
            version: installedVersion,
            reason: enabledValue.restartReason ?? '',
          });
        }
        if (settings.oneClickRestart === false) {
          apply({ phase: 'done', step: null, installedVersion, enabled: true, restartSkipped: true, autoClose: true });
          return;
        }
        const restart = await readRestartCapability();
        if (!isCurrent()) return;
        if (restart.supported !== true) {
          apply({
            phase: 'done',
            step: null,
            installedVersion,
            enabled: true,
            restartSkipped: true,
            restartUnsupported: restart.reason,
            autoClose: true,
          });
          return;
        }
        apply({ phase: 'restarting', step: null, installedVersion, enabled: true, restarting: true });
        try {
          await requestRestart();
        } catch (error) {
          apply({
            phase: 'done',
            step: null,
            installedVersion,
            enabled: true,
            restartError: errorText(error) || t('update.unknown'),
            autoClose: false,
          });
        }
      }

      /**
       * The package name of a registry install spec. Git, tarball, and local
       * paths return null; their installed name comes from the Host result.
       * @param {unknown} spec
       * @returns {string | null}
       */
      function packageNameFromSpec(spec) {
        const text = String(spec ?? '').trim();
        if (text === '' || text.startsWith('.') || text.startsWith('link:') || text.startsWith('file:') || text.includes('://')) return null;
        const at = text.lastIndexOf('@');
        if (at > 0) return text.slice(0, at);
        return text;
      }

      /**
       * Ask the Host which profile bundles were written after it started.
       * @returns {Promise<Array<{ name: string, version?: string, reason?: string }>>}
       */
      async function fetchAuditEntries() {
        try {
          const response = await fetch(AUDIT_API, { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (response.ok && data?.ok === true && Array.isArray(data.entries)) return data.entries;
        } catch {
          /* An older Host without the audit route simply returns none. */
        }
        return [];
      }

      /** The glyph on the injected card button (static; no external asset). */
      const UPDATE_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M8 10.6V3.1M5.2 5.9 8 3.1l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.9 10.4v1A1.6 1.6 0 0 0 4.5 13h7a1.6 1.6 0 0 0 1.6-1.6v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

      /** Tooltip/accessible label for one injected update button. */
      function updateButtonLabel(name, t) {
        return `${t('update.button')} · ${name}`;
      }

      /**
       * Ensure every third-party card in the built-in "Installed plugins"
       * group carries one update button and, when its update waits for a
       * restart, a small restart tag. Idempotent, so React re-renders and the
       * observer can call it repeatedly.
       * @param {Document} doc
       * @param {(name: string) => void} open
       * @param {string[]} pendingNames
       * @param {(key: string, params?: object) => string} t
       * @param {Set<Element>} buttons
       */
      function ensureUpdateButtons(doc, open, pendingNames, t, buttons) {
        if (doc === null || doc === undefined || typeof doc.querySelectorAll !== 'function') return;
        const pending = new Set(Array.isArray(pendingNames) ? pendingNames : []);
        const cards = doc.querySelectorAll('[data-plugin-group="bundles"] [data-plugin-package]');
        for (const card of cards) {
          const name = card.getAttribute('data-plugin-package');
          if (typeof name !== 'string' || name === '') continue;
          let button = card.querySelector('[data-dsh-powerup-update]');
          if (button === null || button === undefined) {
            const head = card.firstElementChild;
            const end = head === null || head === undefined ? null : head.lastElementChild;
            if (end === null || end === undefined) continue;
            button = doc.createElement('button');
            button.type = 'button';
            button.className = 'dsh-powerup-update-button';
            button.setAttribute('data-dsh-powerup-update', '');
            button.innerHTML = UPDATE_BUTTON_ICON;
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              open(name);
            });
            end.insertBefore(button, end.firstChild);
            buttons.add(button);
          }
          const label = updateButtonLabel(name, t);
          if (button.title !== label) button.title = label;
          if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);

          let tag = card.querySelector('[data-dsh-powerup-restart-tag]');
          if (pending.has(name)) {
            if (tag === null || tag === undefined) {
              const head = card.firstElementChild;
              const main = head === null || head === undefined ? null : head.children?.[1];
              const titleRow = main === null || main === undefined ? null : main.firstElementChild;
              if (titleRow !== null && titleRow !== undefined) {
                tag = doc.createElement('span');
                tag.className = 'dsh-powerup-restart-tag';
                tag.setAttribute('data-dsh-powerup-restart-tag', '');
                titleRow.appendChild(tag);
              }
            }
            if (tag !== null && tag !== undefined) {
              const text = t('restart.tag');
              if (tag.textContent !== text) tag.textContent = text;
              if (tag.title !== t('restart.tagHint')) tag.title = t('restart.tagHint');
            }
          } else if (tag !== null && tag !== undefined) {
            tag.remove();
          }
        }
        for (const button of [...buttons]) if (button.isConnected !== true) buttons.delete(button);
      }

      /**
       * Put the pending count and a restart button beside the Installed
       * plugins heading. The bar is always present on that page; its count
       * state changes between "N need a restart" and "none need a restart".
       * @param {Document} doc
       * @param {number} count
       * @param {() => void} onRestart
       * @param {(key: string, params?: object) => string} t
       */
      function ensureRestartBar(doc, count, onRestart, t) {
        if (doc === null || doc === undefined || typeof doc.querySelector !== 'function') return;
        const group = doc.querySelector('[data-plugin-group="bundles"]');
        if (group === null || group === undefined) return;
        const head = group.firstElementChild;
        if (head === null || head === undefined) return;
        let bar = group.querySelector('[data-dsh-powerup-restart-bar]');
        if (bar === null || bar === undefined) {
          bar = doc.createElement('div');
          bar.className = 'dsh-powerup-restart-bar';
          bar.setAttribute('data-dsh-powerup-restart-bar', '');
          const label = doc.createElement('span');
          label.className = 'dsh-powerup-restart-count';
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'dsh-powerup-restart-action';
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onRestart();
          });
          bar.appendChild(label);
          bar.appendChild(button);
          head.appendChild(bar);
        }
        const label = bar.firstElementChild;
        const button = bar.lastElementChild;
        const idle = count <= 0;
        const text = idle ? t('restart.none') : t('restart.pending', { count });
        if (label !== null && label !== undefined) {
          if (label.textContent !== text) label.textContent = text;
          label.setAttribute('data-state', idle ? 'idle' : 'pending');
        }
        const action = t('restart.action');
        if (button !== null && button !== undefined) {
          if (button.textContent !== action) button.textContent = action;
          button.setAttribute('data-state', idle ? 'idle' : 'pending');
        }
      }

      /**
       * Place a floating panel under an anchor, flipping above when the space
       * below is short, and clamp it to the viewport.
       * @param {{ getBoundingClientRect: () => DOMRect }} anchor
       * @param {number} minWidth
       * @param {number} preferredHeight
       * @returns {{ left: number, width: number, top?: number, bottom?: number, maxHeight: number }}
       */
      function popoverPlacement(anchor, minWidth, preferredHeight) {
        const rect = anchor.getBoundingClientRect();
        const gap = 6;
        const margin = 12;
        const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
        const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
        const width = Math.min(Math.max(rect.width, minWidth), Math.max(200, viewportWidth - margin * 2));
        const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
        const spaceBelow = viewportHeight - rect.bottom - margin - gap;
        const spaceAbove = rect.top - margin - gap;
        const above = spaceBelow < Math.min(preferredHeight, 180) && spaceAbove > spaceBelow;
        return {
          left,
          width,
          ...(above ? { bottom: viewportHeight - rect.top + gap } : { top: rect.bottom + gap }),
          maxHeight: Math.max(120, Math.min(preferredHeight, above ? spaceAbove : spaceBelow)),
        };
      }

      /**
       * The row label as the host renders it. Live job rows carry one element
       * whose text and `title` are both the job label; the stop button's own
       * `title` is the localized action name, so it is skipped. Reading the DOM
       * instead of stripping the localized `aria-label` keeps this working in
       * every host language.
       * @param {Element | null | undefined} button
       * @returns {string | undefined}
       */
      function stopButtonLabel(button) {
        if (button === null || button === undefined || typeof button.closest !== 'function') return undefined;
        const item = button.closest('li');
        if (item === null || typeof item.querySelectorAll !== 'function') return undefined;
        for (const node of item.querySelectorAll('[title]')) {
          if (node === button) continue;
          const title = node.getAttribute('title');
          if (typeof title !== 'string' || title === '') continue;
          if (node.textContent === title) return title;
        }
        return undefined;
      }

      /**
       * The session the open jobs panel belongs to. The bridge publishes the
       * active session; when it is unavailable yet, a single watched session
       * with live jobs is unambiguous.
       * @param {{ rows?: Record<string, Array<{ status: string }>> }} snapshot
       * @param {string | undefined} sessionId
       * @returns {string | undefined}
       */
      function stopTargetSession(snapshot, sessionId) {
        const rows = snapshot?.rows ?? {};
        if (typeof sessionId === 'string' && sessionId !== '') return sessionId;
        const candidates = Object.keys(rows).filter((key) => (rows[key] ?? []).some((job) => job.status === 'running'));
        return candidates.length === 1 ? candidates[0] : undefined;
      }

      /**
       * Resolve the job behind a host stop button without importing the jobs
       * plugin: the open panel renders its live rows in start order, so the
       * n-th stop button in the document belongs to the n-th running job. The
       * row label cross-checks that pairing. Returning undefined leaves the
       * host's own stop flow untouched.
       * @param {{ state?: { getSnapshot?: () => { rows?: Record<string, Array<object>> } } } | undefined} jobsService
       * @param {Element | null | undefined} button
       * @param {string | undefined} sessionId
       * @returns {{ sessionId: string, job: { id: string, label: string } } | undefined}
       */
      function resolveStopTarget(jobsService, button, sessionId) {
        if (jobsService === null || jobsService === undefined || button === null || button === undefined) return undefined;
        const state = jobsService.state;
        if (state === undefined || typeof state.getSnapshot !== 'function') return undefined;
        const snapshot = state.getSnapshot();
        const owner = stopTargetSession(snapshot, sessionId);
        if (owner === undefined) return undefined;
        const live = (snapshot?.rows?.[String(owner)] ?? [])
          .filter((job) => job.status === 'running')
          .sort((left, right) => left.startedAt - right.startedAt);
        if (live.length === 0) return undefined;
        const buttons = [...document.querySelectorAll('button[data-kill-state]')];
        const index = buttons.indexOf(button);
        if (index < 0) return undefined;
        const label = stopButtonLabel(button);
        let job = index < live.length ? live[index] : undefined;
        if (job !== undefined && label !== undefined && job.label !== label) job = undefined;
        if (job === undefined && label !== undefined) job = live.find((candidate) => candidate.label === label);
        if (job === undefined) return undefined;
        return { sessionId: owner, job };
      }

      /**
       * The stop-reason popover. The host jobs panel owns an irreversible
       * two-press stop and always records `cancelled by the user`; this overlay
       * intercepts the first press, asks for an optional reason, and posts it to
       * the Host route that kills through the registry with that reason, so the
       * injected completion notice and the model's tool result carry it. If the
       * button cannot be resolved to a job, the event is left alone and the
       * host's original stop flow runs unchanged.
       */
      function JobStopOverlay({ jobs, ctx }) {
        const [target, setTarget] = useState(null);
        const [reason, setReason] = useState('');
        const [pending, setPending] = useState(false);
        const [error, setError] = useState(null);
        const panelRef = useRef(null);
        const inputRef = useRef(null);
        const sequenceRef = useRef(0);
        const t = useCallback((key, params) => translateCurrent(key, params), []);

        const close = useCallback(() => {
          sequenceRef.current += 1;
          setTarget(null);
          setPending(false);
          setError(null);
        }, []);

        useEffect(() => {
          const onClick = (event) => {
            if (event.defaultPrevented) return;
            const node = event.target;
            if (!(node instanceof Element)) return;
            const button = node.closest('button[data-kill-state]');
            if (button === null) return;
            const resolved = resolveStopTarget(jobs, button, bridge.sessionId);
            if (resolved === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            sequenceRef.current += 1;
            setReason('');
            setError(null);
            setPending(false);
            setTarget({ ...resolved, rect: button.getBoundingClientRect() });
          };
          document.addEventListener('click', onClick, true);
          return () => document.removeEventListener('click', onClick, true);
        }, [jobs]);

        useEffect(() => {
          if (target === null) return undefined;
          const onPointerDown = (event) => {
            const panel = panelRef.current;
            if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return;
            close();
          };
          const onScroll = (event) => {
            const panel = panelRef.current;
            if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return;
            close();
          };
          const onResize = () => close();
          document.addEventListener('pointerdown', onPointerDown, true);
          document.addEventListener('scroll', onScroll, true);
          window.addEventListener('resize', onResize);
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
          };
        }, [target, close]);

        // A settled job needs no stop dialog; close it when the roster says it
        // finished (another stop path, a producer exit, or our own request).
        useEffect(() => {
          if (target === null || jobs?.state === undefined) return undefined;
          const state = jobs.state;
          if (typeof state.getSnapshot !== 'function' || typeof state.subscribe !== 'function') return undefined;
          const check = () => {
            const rows = state.getSnapshot()?.rows?.[String(target.sessionId)] ?? [];
            const row = rows.find((job) => String(job.id) === String(target.job.id));
            if (row === undefined || row.status !== 'running') close();
          };
          return state.subscribe(check);
        }, [target, jobs, close]);

        useEffect(() => {
          if (target === null) return undefined;
          const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
          return () => window.clearTimeout(timer);
        }, [target]);

        const submit = async () => {
          if (target === null || pending) return;
          const token = sequenceRef.current;
          setPending(true);
          setError(null);
          try {
            const response = await fetch(JOB_KILL_API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId: target.sessionId,
                jobId: String(target.job.id),
                reason: reason.trim(),
              }),
            });
            let payload = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`);
            if (sequenceRef.current !== token) return;
            setTarget(null);
            setPending(false);
            setReason('');
            setError(null);
          } catch (failure) {
            if (sequenceRef.current !== token) return;
            setPending(false);
            setError(format(t('jobStop.failed'), { message: failure?.message ?? String(failure) }));
          }
        };

        if (target === null) return null;
        const placement = popoverPlacement({ getBoundingClientRect: () => target.rect }, 340, 300);
        // The body portal escapes every slot's stacking context, so the same
        // panel is above the host jobs menu (z-index 100) in both themes.
        return renderInBody(h('div', {
          ref: panelRef,
          className: 'dsh-powerup-jobstop',
          role: 'dialog',
          'aria-label': t('jobStop.title'),
          style: {
            left: `${placement.left}px`,
            width: `${placement.width}px`,
            ...(placement.top !== undefined ? { top: `${placement.top}px` } : { bottom: `${placement.bottom}px` }),
            maxHeight: `${placement.maxHeight}px`,
          },
          // Keep the host jobs menu open while the user interacts: its
          // outside-pointer handler listens on document and would close it.
          onPointerDown: (event) => event.stopPropagation(),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
              return;
            }
            if (event.key !== 'Enter' || event.isComposing === true) return;
            const tag = event.target?.tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
            event.preventDefault();
            void submit();
          },
        },
        h('div', { className: 'dsh-powerup-jobstop-head' },
          h('div', { className: 'dsh-powerup-jobstop-heading' },
            h('span', { className: 'dsh-powerup-jobstop-title' }, t('jobStop.title')),
            h('span', { className: 'dsh-powerup-jobstop-subtitle' }, t('jobStop.subtitle')),
          ),
          h('button', {
            type: 'button',
            className: 'dsh-powerup-jobstop-close',
            'aria-label': t('jobStop.close'),
            title: t('jobStop.close'),
            disabled: pending,
            onClick: close,
          }, '×'),
        ),
        h('div', { className: 'dsh-powerup-jobstop-label', title: target.job.label },
          h('span', { className: 'dsh-powerup-jobstop-dot', 'aria-hidden': 'true' }),
          typeof target.job.kind === 'string' && target.job.kind !== ''
            ? h('span', { className: 'dsh-powerup-jobstop-kind' }, target.job.kind)
            : null,
          h('span', { className: 'dsh-powerup-jobstop-label-text' }, target.job.label),
        ),
        h('div', { className: 'dsh-powerup-jobstop-body' },
          h('label', { className: 'dsh-powerup-jobstop-field' },
            h('span', { className: 'dsh-powerup-jobstop-field-label' }, t('jobStop.reasonLabel')),
            h('input', {
              ref: inputRef,
              className: 'dsh-powerup-jobstop-input',
              type: 'text',
              value: reason,
              maxLength: JOB_STOP_REASON_MAX,
              placeholder: t('jobStop.reasonPlaceholder'),
              disabled: pending,
              onChange: (event) => setReason(event.target.value),
            }),
          ),
          h('p', { className: 'dsh-powerup-jobstop-note' }, t('jobStop.reasonNote')),
          error === null ? null : h('p', { className: 'dsh-powerup-jobstop-error', role: 'alert' }, error),
        ),
        h('div', { className: 'dsh-powerup-jobstop-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-powerup-jobstop-cancel',
            disabled: pending,
            onClick: close,
          }, t('jobStop.cancel')),
          h('button', {
            type: 'button',
            className: 'dsh-powerup-jobstop-confirm',
            disabled: pending,
            onClick: () => { void submit(); },
          }, pending ? t('jobStop.stopping') : t('jobStop.confirm')),
        )));
      }

      /**
       * The Plugins-page update control. It injects one icon button into each
       * third-party card of the built-in "Installed plugins" group, then owns
       * the dialog that removes the old version, installs the selected one
       * through the same `pluginManager` Remote the Add plugin dialog uses,
       * asks about enabling, and offers to restart DSH.
       */
      function PluginUpdateOverlay({ manager, remote, ctx }) {
        const [view, setView] = useState(null);
        const [localeTick, forceLocale] = useState(0);
        const [pending, setPending] = useState(() => readPendingRestarts());
        const [restartAsk, setRestartAsk] = useState(false);
        const [restartCapability, setRestartCapability] = useState(null);
        const [restartBusy, setRestartBusy] = useState(false);
        const [restartError, setRestartError] = useState(null);
        const tokenRef = useRef(null);
        const abortRef = useRef(null);
        const buttonsRef = useRef(new Set());
        const inputRef = useRef(null);
        const versionRef = useRef(null);
        const versionPanelRef = useRef(null);
        const registryRef = useRef(null);
        const registryPanelRef = useRef(null);
        const versionSeq = useRef(0);
        const openRestartRef = useRef(() => {});
        const recordRef = useRef(() => {});
        const tRef = useRef((key, params) => translateCurrent(key, params));
        tRef.current = (key, params) => translateCurrent(key, params);

        useEffect(() => {
          const locale = ctx?.get?.('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((value) => value + 1));
        }, []);

        /** Merge a patch into the open dialog only while its token is current. */
        const patch = useCallback((token, next) => {
          setView((current) => {
            if (current === null || tokenRef.current !== token) return current;
            return { ...current, ...(typeof next === 'function' ? next(current) : next) };
          });
        }, []);

        const close = useCallback(() => {
          const current = view;
          if (current !== null && (current.phase === 'working' || current.phase === 'self-updating' || current.phase === 'restarting' || current.enabling === true)) return;
          tokenRef.current = null;
          try {
            abortRef.current?.abort?.();
          } catch {
            /* ignore */
          }
          abortRef.current = null;
          setView(null);
        }, [view]);

        /** Dismiss both floating panels without touching the dialog. */
        const closePopovers = useCallback(() => {
          setView((current) => current === null ? current : {
            ...current,
            listOpen: false,
            listPopover: null,
            registryOpen: false,
            registryPopover: null,
          });
        }, []);

        /** Remember that one updated plugin waits for a whole-app restart. */
        const recordPending = useCallback((entry) => {
          setPending((current) => {
            const next = current.filter((item) => item.name !== entry.name);
            next.push({ ...entry, at: Date.now() });
            writePendingRestarts(next);
            return next;
          });
        }, []);

        /** Drop a pending marker when its update never started. */
        const removePending = useCallback((name) => {
          setPending((current) => {
            const next = current.filter((item) => item.name !== name);
            writePendingRestarts(next);
            return next;
          });
        }, []);
        recordRef.current = recordPending;

        /** Merge the Host's "profile files newer than the Host" audit into the session list. */
        const mergeAuditEntries = useCallback(async () => {
          const entries = await fetchAuditEntries();
          if (entries.length === 0) return;
          setPending((current) => {
            const byName = new Map(current.map((entry) => [entry.name, entry]));
            for (const entry of entries) {
              if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === '') continue;
              byName.set(entry.name, {
                name: entry.name,
                version: typeof entry.version === 'string' ? entry.version : '',
                reason: typeof entry.reason === 'string' ? entry.reason : 'audit',
                at: Date.now(),
              });
            }
            const next = [...byName.values()];
            writePendingRestarts(next);
            return next;
          });
        }, []);

        useEffect(() => {
          let cancelled = false;
          void fetchAuditEntries().then((entries) => {
            if (cancelled || entries.length === 0) return;
            setPending((current) => {
              const byName = new Map(current.map((entry) => [entry.name, entry]));
              for (const entry of entries) {
                if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === '') continue;
                byName.set(entry.name, {
                  name: entry.name,
                  version: typeof entry.version === 'string' ? entry.version : '',
                  reason: typeof entry.reason === 'string' ? entry.reason : 'audit',
                  at: Date.now(),
                });
              }
              const next = [...byName.values()];
              writePendingRestarts(next);
              return next;
            });
          });
          return () => { cancelled = true; };
        }, []);

        useEffect(() => {
          if (remote === undefined || remote === null || typeof remote.$on !== 'function') return undefined;
          const off = remote.$on('plugin-manager/changed', () => {
            void mergeAuditEntries();
          });
          return () => {
            try {
              off?.();
            } catch {
              /* ignore */
            }
          };
        }, [remote, mergeAuditEntries]);

        // Observe every management call made by the built-in Plugins page (and
        // by this dialog) so an update performed through Add plugin/Update also
        // leaves a restart marker. The audit route covers updates that were
        // applied without a restart-required result.
        useEffect(() => {
          if (manager === undefined || manager === null || typeof manager.installBundle !== 'function') return undefined;
          const disposers = [];
          const wrap = (key, nameFrom) => {
            const original = manager[key];
            if (typeof original !== 'function') return;
            const wrapped = async function (...args) {
              const result = await original.apply(this, args);
              try {
                if (result?.ok === true && result.value?.application === 'restart-required') {
                  const name = nameFrom(args, result.value);
                  if (typeof name === 'string' && name !== '') {
                    recordRef.current({
                      name,
                      version: typeof result.value.version === 'string' ? result.value.version : '',
                      reason: typeof result.value.restartReason === 'string' ? result.value.restartReason : '',
                    });
                  }
                }
              } catch {
                /* A marker must never change the management result. */
              }
              return result;
            };
            try {
              manager[key] = wrapped;
              disposers.push(() => {
                if (manager[key] === wrapped) manager[key] = original;
              });
            } catch {
              /* A frozen Remote namespace keeps the explicit records in this dialog. */
            }
          };
          wrap('installBundle', (args, value) => value.bundle ?? packageNameFromSpec(args[0]));
          wrap('setBundleEnabled', (args, value) => value.target ?? args[0]);
          wrap('removeBundle', (args, value) => value.target ?? args[0]);
          return () => {
            for (const dispose of disposers) dispose();
          };
        }, [manager]);

        const loadVersions = useCallback(async (token, name, choice, choices, resetVersion) => {
          const t = tRef.current;
          const seq = versionSeq.current + 1;
          versionSeq.current = seq;
          const current = () => versionSeq.current === seq && tokenRef.current === token;
          patch(token, { versionsState: 'loading', versionsError: null, versionsRegistry: null, ...(resetVersion === true ? { versions: [], version: '', latest: null } : {}) });
          let lastError = null;
          for (const candidate of lookupRegistries(choices, choice)) {
            if (!current()) return;
            const lifetime = abortRef.current?.signal;
            const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(15000)
              : null;
            const fetchSignal = lifetime !== undefined && lifetime !== null && timeout !== null && typeof AbortSignal.any === 'function'
              ? AbortSignal.any([lifetime, timeout])
              : (lifetime ?? timeout ?? undefined);
            try {
              const result = await fetchRegistryVersions(registryFetchUrl(candidate), name, fetchSignal);
              if (!current()) return;
              if (result.versions.length === 0) {
                lastError = new Error(t('update.versionsEmpty'));
                continue;
              }
              patch(token, { versions: result.versions, versionsState: 'ready', versionsError: null, versionsRegistry: candidate, latest: result.latest });
              return;
            } catch (error) {
              if (!current()) return;
              lastError = error;
              if (abortRef.current?.signal?.aborted === true) return;
            }
          }
          patch(token, { versionsState: 'error', versionsError: errorText(lastError) || t('update.unknown') });
        }, [patch]);

        const openFor = useCallback(async (name) => {
          const t = tRef.current;
          const token = {};
          tokenRef.current = token;
          try {
            abortRef.current?.abort?.();
          } catch {
            /* ignore */
          }
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          abortRef.current = controller;
          setView({
            name,
            title: name,
            self: name === MODULE_ID,
            currentVersion: null,
            phase: 'loading',
            step: null,
            choices: [],
            registryKey: '',
            defaultRegistryKey: null,
            versions: [],
            versionsState: 'loading',
            versionsError: null,
            versionsRegistry: null,
            version: '',
            listOpen: false,
            listPopover: null,
            registryOpen: false,
            registryPopover: null,
            error: null,
            formError: null,
            log: '',
            enabling: false,
            restarting: false,
          });
          try {
            const [bundles, registries] = await Promise.all([manager.listBundles(), manager.registries()]);
            if (tokenRef.current !== token) return;
            if (!bundles.ok) throw new Error(bundles.error?.message ?? t('update.unknown'));
            const pkg = (bundles.value ?? []).find((item) => item.name === name);
            if (pkg === undefined) throw new Error(t('update.unknown'));
            if (pkg.readOnlyReason !== undefined || pkg.removable === false) {
              patch(token, {
                title: packageDisplayTitle(pkg),
                currentVersion: pkg.version ?? null,
                phase: 'blocked',
                error: pkg.readOnlyReason === 'management-required' ? t('update.notRemovable') : null,
              });
              return;
            }
            const remembered = readRememberedRegistry();
            const powerupDefault = readDefaultRegistry();
            const choices = buildRegistryChoices(registries.ok ? registries.value : null, remembered, powerupDefault, t);
            const choice = pickRegistryChoice(choices, remembered, powerupDefault);
            const starred = matchStoredChoice(choices, powerupDefault);
            patch(token, {
              title: packageDisplayTitle(pkg),
              currentVersion: pkg.version ?? null,
              installed: pkg.installed === true,
              enabled: pkg.enabled !== false,
              choices,
              registryKey: choice.key,
              defaultRegistryKey: starred === undefined ? null : starred.key,
              versionsState: 'loading',
            });
            // Keep the loading spinner until the mirror's version list has
            // settled, so the chooser never flashes with an empty list.
            await loadVersions(token, name, choice, choices, false);
            if (tokenRef.current !== token) return;
            patch(token, { phase: 'choose' });
          } catch (error) {
            patch(token, { phase: 'error', error: errorText(error) || t('update.unknown') });
          }
        }, [loadVersions, manager, patch]);

        // Inject an update button into every third-party installed card. The
        // built-in page owns these nodes, so re-assert after React renders and
        // remove our own buttons on unload. Open through a ref to keep the
        // observer alive across state changes.
        const openRef = useRef(openFor);
        openRef.current = openFor;
        useEffect(() => {
          const buttons = buttonsRef.current;
          let scheduled = false;
          let stopped = false;
          const ensure = () => {
            scheduled = false;
            if (stopped) return;
            const names = pending.map((entry) => entry.name);
            ensureUpdateButtons(document, (name) => openRef.current(name), names, tRef.current, buttons);
            ensureRestartBar(document, pending.length, () => openRestartRef.current(), tRef.current);
          };
          const schedule = () => {
            if (scheduled || stopped) return;
            scheduled = true;
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(ensure);
            else window.setTimeout(ensure, 16);
          };
          ensure();
          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true });
          return () => {
            stopped = true;
            observer.disconnect();
            for (const button of buttons) {
              try {
                button.remove();
              } catch {
                /* ignore */
              }
            }
            buttons.clear();
          };
        }, [localeTick, pending]);

        // Keep the selected version input focused when the chooser opens.
        useEffect(() => {
          if (view !== null && view.phase === 'choose' && inputRef.current !== null) {
            try {
              inputRef.current.focus();
            } catch {
              /* focus is best-effort */
            }
          }
        }, [view === null ? null : view.phase]);

        // Escape closes the innermost floating panel first, then the dialog.
        useEffect(() => {
          if (view === null) return undefined;
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            if (view.registryOpen === true) {
              setView((current) => current === null ? current : { ...current, registryOpen: false, registryPopover: null });
              return;
            }
            if (view.phase === 'choose' && view.listOpen === true) {
              setView((current) => current === null ? current : { ...current, listOpen: false, listPopover: null });
              return;
            }
            close();
          };
          document.addEventListener('keydown', onKeyDown, true);
          return () => document.removeEventListener('keydown', onKeyDown, true);
        }, [view, close]);

        // Clicking outside the open floating panel and its trigger dismisses it.
        useEffect(() => {
          if (view === null || (view.registryOpen !== true && view.listOpen !== true)) return undefined;
          const onPointerDown = (event) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            const inside = [versionRef.current, versionPanelRef.current, registryRef.current, registryPanelRef.current]
              .some((root) => root !== null && root.contains(target));
            if (inside) return;
            closePopovers();
          };
          document.addEventListener('pointerdown', onPointerDown, true);
          return () => document.removeEventListener('pointerdown', onPointerDown, true);
        }, [view === null ? null : `${String(view.registryOpen)}:${String(view.listOpen)}`, closePopovers]);

        // Scrolling the dialog or the page would leave a fixed panel behind;
        // dismiss it instead. Scrolling inside the panel itself is allowed.
        useEffect(() => {
          if (view === null || (view.registryOpen !== true && view.listOpen !== true)) return undefined;
          const onScroll = (event) => {
            const target = event.target;
            if (target instanceof Node) {
              const insidePanel = [versionPanelRef.current, registryPanelRef.current]
                .some((panel) => panel !== null && panel.contains(target));
              if (insidePanel) return;
            }
            closePopovers();
          };
          const onResize = () => closePopovers();
          document.addEventListener('scroll', onScroll, true);
          window.addEventListener('resize', onResize);
          return () => {
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
          };
        }, [view === null ? null : `${String(view.registryOpen)}:${String(view.listOpen)}`, closePopovers]);

        // Show pnpm output while an installation runs.
        useEffect(() => {
          if (remote === undefined || remote === null || typeof remote.$on !== 'function') return undefined;
          const offLog = remote.$on('plugin-manager/install-log', (chunk) => {
            if (chunk === null || typeof chunk !== 'object') return;
            const token = tokenRef.current;
            const text = typeof chunk.text === 'string' ? chunk.text : '';
            if (token === null || text === '') return;
            setView((current) => current === null || current.phase !== 'working'
              ? current
              : { ...current, log: (current.log + text).slice(-2400) });
          });
          return () => {
            try {
              offLog?.();
            } catch {
              /* ignore */
            }
          };
        }, [remote]);

        // Escape dismisses the list-header restart confirmation unless a
        // restart request is already in flight.
        useEffect(() => {
          if (!restartAsk) return undefined;
          const onKeyDown = (event) => {
            if (event.key !== 'Escape' || restartBusy) return;
            event.stopPropagation();
            setRestartAsk(false);
          };
          document.addEventListener('keydown', onKeyDown, true);
          return () => document.removeEventListener('keydown', onKeyDown, true);
        }, [restartAsk, restartBusy]);

        // A one-click update that does not restart leaves a completion panel;
        // close it on its own so it never lingers over the Plugins page.
        useEffect(() => {
          if (view === null || view.phase !== 'done' || view.autoClose !== true) return undefined;
          const timer = window.setTimeout(() => {
            setView((current) => {
              if (current === null || current.phase !== 'done' || current.autoClose !== true) return current;
              tokenRef.current = null;
              try {
                abortRef.current?.abort?.();
              } catch {
                /* ignore */
              }
              abortRef.current = null;
              return null;
            });
          }, ONE_CLICK_AUTO_CLOSE_MS);
          return () => window.clearTimeout(timer);
        }, [view === null ? null : view.phase, view === null ? null : view.autoClose]);

        const chooseVersion = (version) => {
          if (tokenRef.current === null) return;
          setView((current) => current === null ? current : { ...current, version, listOpen: false, listPopover: null, formError: null });
        };

        const chooseRegistry = (key) => {
          const token = tokenRef.current;
          if (token === null) return;
          const current = view;
          if (current === null) return;
          const choice = current.choices.find((item) => item.key === key);
          if (choice === undefined) return;
          setView((state) => state === null ? state : { ...state, registryKey: key, registryOpen: false, registryPopover: null, formError: null });
          loadVersions(token, current.name, choice, current.choices, true);
        };

        /** Star one registry as Power-Up's default and select it for this update. */
        const setDefaultRegistry = (choice) => {
          if (choice === null || choice === undefined) return;
          const current = view;
          writeDefaultRegistry(choice);
          setView((state) => state === null ? state : {
            ...state,
            defaultRegistryKey: choice.key,
            registryKey: choice.key,
          });
          if (current !== null) loadVersions(tokenRef.current, current.name, choice, current.choices, true);
        };

        /** Open or close the floating version list under the input row. */
        const toggleVersionList = () => {
          const current = view;
          if (current === null || current.phase !== 'choose') return;
          if (current.listOpen === true) {
            setView((state) => state === null ? state : { ...state, listOpen: false, listPopover: null });
            return;
          }
          const anchor = versionRef.current;
          const popover = anchor === null ? null : popoverPlacement(anchor, 280, 260);
          setView((state) => state === null ? state : {
            ...state,
            listOpen: true,
            listPopover: popover,
            registryOpen: false,
            registryPopover: null,
          });
        };

        /** Open or close the floating registry menu under its trigger. */
        const toggleRegistry = () => {
          const current = view;
          if (current === null || current.phase !== 'choose') return;
          if (current.registryOpen === true) {
            setView((state) => state === null ? state : { ...state, registryOpen: false, registryPopover: null });
            return;
          }
          const anchor = registryRef.current;
          const popover = anchor === null ? null : popoverPlacement(anchor, 280, 220);
          setView((state) => state === null ? state : {
            ...state,
            registryOpen: true,
            registryPopover: popover,
            listOpen: false,
            listPopover: null,
          });
        };

        const startUpdate = async (options = {}) => {
          const token = tokenRef.current;
          const current = view;
          if (token === null || current === null || current.phase !== 'choose') return;
          const t = tRef.current;
          const oneClick = options?.oneClick === true;
          // Both paths install the version in the input. One-click only skips
          // the enable/restart questions, so reinstalling or downgrading works.
          const version = installVersion(current);
          if (version === '') {
            setView((state) => state === null ? state : {
              ...state,
              formError: t(oneClick ? 'update.oneClickNoVersion' : 'update.invalidVersion'),
            });
            return;
          }
          const choice = current.choices.find((item) => item.key === current.registryKey) ?? current.choices[0];
          const registry = registryValue(choice);
          const spec = `${current.name}@${version}`;
          const requestId = newRequestId();
          const previousVersion = typeof current.currentVersion === 'string' && current.currentVersion !== '' ? current.currentVersion : null;
          const previousEnabled = current.enabled !== false;
          let removedOld = false;
          patch(token, {
            phase: 'working',
            step: current.self === true ? 'installing' : 'removing',
            error: null,
            formError: null,
            log: '',
            logLabel: spec,
            oneClick,
            listOpen: false,
            listPopover: null,
            registryOpen: false,
            registryPopover: null,
          });
          if (current.self === true) {
            // Power-Up cannot reinstall itself from its own client: removing
            // the bundle unloads this dialog. The Host route receives the
            // request, answers, then hands remove+inspect+install to the
            // built-in manager service, which keeps running in the Host
            // process after this plugin unloads.
            recordPending({ name: MODULE_ID, version, reason: 'self-update' });
            try {
              const response = await fetch(SELF_UPDATE_API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ version, registry }),
              });
              const data = await response.json().catch(() => null);
              if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? `HTTP ${response.status}`);
              patch(token, { phase: 'self-updating', step: null });
            } catch (error) {
              removePending(MODULE_ID);
              patch(token, { phase: 'error', step: null, error: errorText(error) || t('update.unknown') });
            }
            return;
          }
          try {
            // The update flow removes the old version first: the Host's
            // inspection refuses a package that is still installed, so the
            // version is checked after removal, exactly where Add plugin
            // performs its own check.
            const removed = await manager.removeBundle(current.name);
            if (tokenRef.current !== token) return;
            if (!removed.ok) throw new Error(removed.error?.message ?? t('update.unknown'));
            if (removed.value.error !== undefined || removed.value.application === 'failed') throw new Error(operationReason(removed.value, t));
            if (removed.value.application === 'cancelled') throw new Error(t('update.cancelled'));
            removedOld = true;
            patch(token, { step: 'checking' });
            const checked = await manager.inspect(spec, { registry });
            if (tokenRef.current !== token) return;
            if (!checked.ok) throw new Error(checked.error?.message ?? t('update.unknown'));
            if (checked.value.status !== 'accepted') throw new Error(inspectReason(checked.value, t));
            if (checked.value.bundle === false) throw new Error(t('update.notBundle'));
            patch(token, { step: 'installing' });
            const installed = await manager.installBundle(spec, { enabled: false, requestId, registry });
            if (tokenRef.current !== token) return;
            if (!installed.ok) throw new Error(installed.error?.message ?? t('update.unknown'));
            const value = installed.value;
            if (value.error !== undefined || value.application === 'failed') throw new Error(operationReason(value, t));
            if (value.application === 'cancelled') throw new Error(t('update.cancelled'));
            const restartRequired = value.application === 'restart-required';
            if (restartRequired) {
              recordPending({
                name: current.name,
                version: value.version ?? version,
                reason: value.restartReason ?? '',
              });
            }
            if (oneClick) {
              // No enable/restart questions: apply the stored defaults.
              await runOneClickUpdate({
                manager,
                name: current.name,
                installedVersion: value.version ?? version,
                restartRequired,
                settings: getSettings(),
                apply: (delta) => patch(token, delta),
                isCurrent: () => tokenRef.current === token,
                recordPending,
                readRestartCapability,
                requestRestart: requestAppRestart,
                t,
              });
              return;
            }
            patch(token, {
              phase: 'enable',
              step: null,
              installedVersion: value.version ?? version,
              restartRequired,
              enabling: false,
            });
          } catch (error) {
            const original = errorText(error) || t('update.unknown');
            // Before the first successful step the old copy is still installed;
            // after it, a failed inspect/install must put the old version back.
            if (!removedOld) {
              patch(token, { phase: 'error', step: null, error: original });
              return;
            }
            if (previousVersion === null) {
              patch(token, { phase: 'error', step: null, error: original, rollbackUnavailable: true });
              return;
            }
            patch(token, { phase: 'working', step: 'rollback', rollbackVersion: previousVersion, error: null, formError: null });
            try {
              const restored = await restorePreviousBundle(manager, {
                name: current.name,
                version: previousVersion,
                enabled: previousEnabled,
                registry,
              }, t);
              if (tokenRef.current !== token) return;
              if (restored.restartRequired === true) {
                recordPending({ name: current.name, version: restored.version, reason: restored.restartReason });
              }
              patch(token, { phase: 'error', step: null, error: original, rolledBack: true, rollbackVersion: restored.version });
            } catch (rollbackFailure) {
              if (tokenRef.current !== token) return;
              patch(token, {
                phase: 'error',
                step: null,
                error: original,
                rollbackVersion: previousVersion,
                rollbackError: errorText(rollbackFailure) || t('update.unknown'),
              });
            }
          }
        };

        /** Ask the Host route whether this runtime can restart itself. */
        const readRestartCapability = async () => {
          try {
            const response = await fetch(UPDATE_API, { headers: { accept: 'application/json' } });
            const data = await response.json();
            return {
              supported: response.ok && data?.ok === true && data.supported === true,
              reason: typeof data?.reason === 'string' ? data.reason : '',
            };
          } catch (error) {
            return { supported: false, reason: errorText(error) };
          }
        };

        /** POST the restart command; throws when the Host refuses. */
        const requestAppRestart = async () => {
          const response = await fetch(UPDATE_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'restart' }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? `HTTP ${response.status}`);
        };

        /** Open the list-header restart confirmation and read the capability. */
        const openRestart = () => {
          setRestartAsk(true);
          setRestartCapability(null);
          setRestartError(null);
          setRestartBusy(false);
          void readRestartCapability().then((capability) => setRestartCapability(capability));
        };
        openRestartRef.current = openRestart;

        /** Confirm the list-header restart. */
        const confirmRestart = async () => {
          if (restartBusy) return;
          setRestartBusy(true);
          setRestartError(null);
          try {
            await requestAppRestart();
          } catch (error) {
            setRestartBusy(false);
            setRestartError(errorText(error) || tRef.current('update.unknown'));
          }
        };

        const enableNow = async () => {
          const token = tokenRef.current;
          const current = view;
          if (token === null || current === null) return;
          const t = tRef.current;
          patch(token, { enabling: true, enableError: null });
          try {
            const result = await manager.setBundleEnabled(current.name, true);
            if (tokenRef.current !== token) return;
            if (!result.ok) throw new Error(result.error?.message ?? t('update.unknown'));
            if (result.value.error !== undefined) throw new Error(operationReason(result.value, t));
            if (result.value.application === 'restart-required' || current.restartRequired === true) {
              recordPending({
                name: current.name,
                version: current.installedVersion ?? '',
                reason: result.value.restartReason ?? '',
              });
            }
            const restart = await readRestartCapability();
            patch(token, { phase: 'restart', enabling: false, restart });
          } catch (error) {
            patch(token, { enabling: false, enableError: errorText(error) || t('update.unknown') });
          }
        };

        const enableLater = () => {
          const token = tokenRef.current;
          if (token === null) return;
          patch(token, { phase: 'done', enabled: false });
        };

        const skipRestart = () => {
          const token = tokenRef.current;
          if (token === null) return;
          patch(token, { phase: 'done', restartSkipped: true });
        };

        const restartNow = async () => {
          const token = tokenRef.current;
          if (token === null) return;
          const t = tRef.current;
          patch(token, { restarting: true, restartError: null });
          try {
            await requestAppRestart();
            patch(token, { phase: 'restarting', restarting: true });
          } catch (error) {
            patch(token, { restarting: false, restartError: errorText(error) || t('update.unknown') });
          }
        };

        const t = (key, params) => translateCurrent(key, params);

        /** One tinted notice: the success/warn/error states share this chrome. */
        const notice = (tone, icon, title, message) => h('div', { className: `dsh-powerup-update-notice ${tone}` },
          icon,
          h('div', { className: 'dsh-powerup-update-notice-copy' },
            title === null || title === undefined ? null : h('span', { className: 'dsh-powerup-update-notice-title' }, title),
            message === null || message === undefined ? null : h('span', null, message),
          ),
        );

        const restartPrompt = restartAsk ? h('div', {
          className: 'dsh-powerup-update-mask',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !restartBusy) setRestartAsk(false);
          },
        },
        h('div', {
          className: 'dsh-powerup-update-dialog',
          style: { width: 'min(420px,100%)' },
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-powerup-restart-title',
        },
        h('div', { className: 'dsh-powerup-update-head' },
          h('div', { className: 'dsh-powerup-update-heading' },
            h('h2', { id: 'dsh-powerup-restart-title' }, t('restart.title')),
            h('p', null, t('restart.pending', { count: pending.length })),
          ),
          restartBusy ? null : h('button', { type: 'button', className: 'dsh-powerup-update-close', 'aria-label': t('update.close'), onClick: () => setRestartAsk(false) }, '×'),
        ),
        h('div', { className: 'dsh-powerup-update-body' },
          h('p', { className: 'dsh-powerup-update-note' }, t('restart.desc')),
          restartCapability !== null && restartCapability.supported !== true
            ? notice('warn', h(WarnIcon, { size: 14 }), null, t('update.restartUnsupported', { reason: restartCapability.reason ?? '' }))
            : null,
          restartError === null ? null : notice('error', h(WarnIcon, { size: 14 }), null, restartError),
          restartBusy
            ? h('div', { className: 'dsh-powerup-update-status' },
              h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
              t('update.restarting'),
            )
            : null,
        ),
        h('div', { className: 'dsh-powerup-update-foot' },
          h('button', { type: 'button', className: 'dsh-powerup-update-ghost', disabled: restartBusy, onClick: () => setRestartAsk(false) }, t('restart.cancel')),
          h('button', {
            type: 'button',
            className: 'dsh-powerup-update-primary',
            disabled: restartBusy || restartCapability?.supported !== true,
            onClick: confirmRestart,
          }, restartBusy ? t('update.restarting') : t('restart.confirm')),
        ),
        ),
        ) : null;

        if (view === null) return restartPrompt;
        const busy = view.phase === 'working' || view.phase === 'self-updating' || view.phase === 'restarting' || view.enabling === true;
        const canClose = !busy;
        const title = view.title === undefined || view.title === '' ? view.name : view.title;
        const showVersions = view.phase === 'choose' && view.listOpen === true;
        // One-click install uses exactly what the version input holds.
        const quickVersion = installVersion(view);
        const quickAvailable = view.self !== true && quickVersion !== '';

        const footer = (() => {
          if (view.phase === 'choose') {
            return [
              h('button', { key: 'cancel', type: 'button', className: 'dsh-powerup-update-ghost', onClick: close }, t('update.cancel')),
              view.self === true
                ? null
                : h('button', {
                  key: 'quick',
                  type: 'button',
                  className: 'dsh-powerup-update-quick',
                  disabled: !quickAvailable,
                  title: quickAvailable
                    ? t('update.oneClickHint', { version: quickVersion })
                    : t('update.oneClickNoVersion'),
                  onClick: () => startUpdate({ oneClick: true }),
                }, h(QuickIcon, { size: 13 }), t('update.oneClick')),
              h('button', {
                key: 'start',
                type: 'button',
                className: 'dsh-powerup-update-primary',
                disabled: quickVersion === '',
                onClick: () => startUpdate(),
              }, t('update.start')),
            ].filter(Boolean);
          }
          if (view.phase === 'enable') {
            return [
              h('button', { key: 'later', type: 'button', className: 'dsh-powerup-update-ghost', disabled: view.enabling === true, onClick: enableLater }, t('update.enableLater')),
              h('button', { key: 'now', type: 'button', className: 'dsh-powerup-update-primary', disabled: view.enabling === true, onClick: enableNow }, view.enabling === true ? t('update.step.enabling') : t('update.enableNow')),
            ];
          }
          if (view.phase === 'restart') {
            const supported = view.restart?.supported === true;
            return [
              h('button', { key: 'later', type: 'button', className: 'dsh-powerup-update-ghost', disabled: view.restarting === true, onClick: skipRestart }, supported ? t('update.restartLater') : t('update.close')),
              supported ? h('button', { key: 'now', type: 'button', className: 'dsh-powerup-update-primary', disabled: view.restarting === true, onClick: restartNow }, view.restarting === true ? t('update.restarting') : t('update.restartNow')) : null,
            ].filter(Boolean);
          }
          if (view.phase === 'restarting' || view.phase === 'working' || view.phase === 'self-updating' || view.phase === 'loading') return [];
          return [
            h('button', { key: 'done', type: 'button', className: 'dsh-powerup-update-primary', onClick: close }, view.phase === 'done' ? t('update.doneButton') : t('update.close')),
          ];
        })();

        const currentChoice = view.choices.find((item) => item.key === view.registryKey) ?? view.choices[0];

        /** Rows of the floating version list, including its loading/error states. */
        const versionRows = (() => {
          if (view.versionsState === 'loading') {
            return [h('div', { key: 'state', className: 'dsh-powerup-update-list-state' },
              h('div', { className: 'dsh-powerup-update-status' },
                h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
                t('update.loadingVersions'),
              ),
            )];
          }
          if (view.versionsState === 'error') {
            return [h('div', { key: 'state', className: 'dsh-powerup-update-list-state' },
              notice('error', h(WarnIcon, { size: 14 }), null, t('update.versionsFailed', { message: view.versionsError ?? '' })),
              h('button', {
                type: 'button',
                className: 'dsh-powerup-update-ghost',
                onClick: () => loadVersions(tokenRef.current, view.name, currentChoice, view.choices, false),
              }, t('update.retry')),
            )];
          }
          if ((view.versions ?? []).length === 0) {
            return [h('div', { key: 'state', className: 'dsh-powerup-update-list-state' },
              h('p', { className: 'dsh-powerup-update-note' }, t('update.versionsEmpty')),
            )];
          }
          return [
            h('div', { key: 'head', className: 'dsh-powerup-update-list-head' },
              h('span', null, t('update.versionsCount', { count: view.versions.length })),
              view.versionsRegistry === null || view.versionsRegistry === undefined
                ? null
                : h('span', { title: view.versionsRegistry.hint }, view.versionsRegistry.hint),
            ),
            ...view.versions.map((version) => {
              const tagKind = versionTagKind(version, view.currentVersion, view.latest);
              return h('button', {
                key: version,
                type: 'button',
                role: 'option',
                className: 'dsh-powerup-update-version',
                'aria-selected': version === view.version ? 'true' : 'false',
                'data-current': version === view.currentVersion ? '' : undefined,
                onClick: () => chooseVersion(version),
              },
              h('span', null, version),
              h('span', { className: 'dsh-powerup-update-trailing' },
                tagKind === null ? null : h('span', {
                  className: `dsh-powerup-update-tag${tagKind === 'latest' ? '' : ' is-current'}`,
                }, t(tagKind === 'current-latest' ? 'update.currentAndLatest' : tagKind === 'current' ? 'update.currentTag' : 'update.latest')),
                version === view.version ? h('span', { className: 'dsh-powerup-update-check' }, h(CheckIcon, { size: 13 })) : null,
              ),
              );
            }),
          ];
        })();

        const body = (() => {
          if (view.phase === 'loading') {
            return h('div', { className: 'dsh-powerup-update-status' },
              h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
              t('update.loading'),
            );
          }
          if (view.phase === 'self-updating') {
            return [
              h('div', { key: 'status', className: 'dsh-powerup-update-status' },
                h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
                t('update.selfUpdating'),
              ),
              h('p', { key: 'note', className: 'dsh-powerup-update-note' }, t('update.selfRefresh')),
              h('span', { key: 'name', className: 'dsh-powerup-update-name' }, view.name),
            ];
          }
          if (view.phase === 'blocked') {
            return notice('error', h(WarnIcon, { size: 15 }), t('update.unsupportedTitle'), view.error ?? t('update.notRemovable'));
          }
          if (view.phase === 'choose') {
            return [
              h('div', { key: 'summary', className: 'dsh-powerup-update-summary' },
                h('div', { className: 'dsh-powerup-update-now' },
                  h('span', { className: 'label' }, t('update.current')),
                  h('code', null, view.currentVersion ?? '—'),
                  view.installed === false ? h('span', { className: 'dsh-powerup-update-note' }, t('update.installedChip')) : null,
                ),
                h('span', { className: 'dsh-powerup-update-name' }, view.name),
              ),
              view.self === true
                ? notice('warn', h(WarnIcon, { size: 14 }), null, t('update.selfUpdateWarning'))
                : null,
              h('div', { key: 'version', className: 'dsh-powerup-update-field' },
                h('label', { className: 'dsh-powerup-update-label', htmlFor: 'dsh-powerup-update-version' }, t('update.versionLabel')),
                h('div', { className: 'dsh-powerup-update-row', ref: versionRef },
                  h('input', {
                    id: 'dsh-powerup-update-version',
                    ref: inputRef,
                    className: 'dsh-powerup-update-input',
                    type: 'text',
                    value: view.version ?? '',
                    placeholder: t('update.versionPlaceholder'),
                    autoComplete: 'off',
                    spellCheck: false,
                    onChange: (event) => setView((current) => current === null ? current : { ...current, version: event.target.value, formError: null }),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') startUpdate();
                    },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dsh-powerup-update-toggle',
                    'aria-expanded': showVersions ? 'true' : 'false',
                    'aria-controls': 'dsh-powerup-update-versions',
                    onClick: toggleVersionList,
                  },
                  showVersions ? t('update.hideVersions') : t('update.chooseVersion'),
                  h('span', { className: 'chevron' }, h(ChevronDownIcon, { size: 12 })),
                  ),
                ),
                view.formError === null || view.formError === undefined
                  ? null
                  : notice('error', h(WarnIcon, { size: 14 }), null, view.formError),
              ),
              h('div', { key: 'registry', className: 'dsh-powerup-update-field' },
                h('span', { className: 'dsh-powerup-update-label' }, t('update.registry')),
                h('div', { className: 'dsh-powerup-update-select', ref: registryRef },
                  h('button', {
                    type: 'button',
                    className: 'dsh-powerup-update-select-trigger',
                    'aria-haspopup': 'listbox',
                    'aria-expanded': view.registryOpen === true ? 'true' : 'false',
                    onClick: toggleRegistry,
                  },
                  h('span', { className: 'dsh-powerup-update-select-value' }, currentChoice?.label ?? ''),
                  h('span', { className: 'dsh-powerup-update-select-host' }, currentChoice?.hint ?? ''),
                  h('span', { className: 'chevron' }, h(ChevronDownIcon, { size: 12 })),
                  ),
                ),
                view.versionsRegistry === null || view.versionsRegistry === undefined
                  ? null
                  : h('span', { className: 'dsh-powerup-update-note' }, t('update.registryFrom', { registry: view.versionsRegistry.hint })),
              ),
              view.self === true
                ? null
                : h('div', { key: 'quick', className: 'dsh-powerup-update-quick-note' },
                  h('div', { className: 'dsh-powerup-update-quick-note-title' },
                    h(QuickIcon, { size: 13 }),
                    t('update.oneClickTitle'),
                  ),
                  h('p', { className: 'dsh-powerup-update-note' }, quickAvailable
                    ? t('update.oneClickHint', { version: quickVersion })
                    : t('update.oneClickNoVersion')),
                  quickAvailable
                    ? h('p', { className: 'dsh-powerup-update-note' }, t('update.oneClickDefaults', {
                      enable: getSettings().oneClickEnable === false ? t('update.off') : t('update.on'),
                      restart: getSettings().oneClickRestart === false ? t('update.off') : t('update.on'),
                    }))
                    : null,
                ),
            ];
          }
          if (view.phase === 'working') {
            const label = view.step === 'removing'
              ? t('update.step.removing')
              : view.step === 'installing'
                ? t('update.step.installing', { version: view.logLabel ?? '' })
                : view.step === 'rollback'
                  ? t('update.step.rollback', { version: view.rollbackVersion ?? view.currentVersion ?? '' })
                  : view.step === 'enabling'
                    ? t('update.step.enabling')
                    : t('update.step.checking');
            return [
              h('div', { key: 'status', className: 'dsh-powerup-update-status' },
                h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
                label,
              ),
              h('div', { key: 'summary', className: 'dsh-powerup-update-summary' },
                h('span', { className: 'dsh-powerup-update-name' }, view.name),
              ),
              view.log === '' ? null : h('div', { key: 'log', className: 'dsh-powerup-update-field' },
                h('span', { className: 'dsh-powerup-update-label' }, t('update.log')),
                h('pre', { className: 'dsh-powerup-update-log' }, view.log),
              ),
            ];
          }
          if (view.phase === 'enable') {
            return [
              notice('success', h(CheckIcon, { size: 15 }), t('update.enableTitle'), t('update.enableDesc')),
              h('div', { key: 'summary', className: 'dsh-powerup-update-summary' },
                h('span', { className: 'dsh-powerup-update-name' }, view.name),
                h('div', { className: 'dsh-powerup-update-now' },
                  h('span', { className: 'label' }, t('update.versionLabel')),
                  h('code', null, view.installedVersion ?? '—'),
                ),
              ),
              view.enableError === null || view.enableError === undefined
                ? null
                : notice('error', h(WarnIcon, { size: 14 }), t('update.errorTitle'), t('update.enableFailed', { message: view.enableError })),
            ];
          }
          if (view.phase === 'restart') {
            const supported = view.restart?.supported === true;
            return [
              notice('success', h(CheckIcon, { size: 15 }), t('update.restartTitle'), t('update.restartDesc')),
              h('div', { key: 'summary', className: 'dsh-powerup-update-summary' },
                h('span', { className: 'dsh-powerup-update-name' }, view.name),
                h('div', { className: 'dsh-powerup-update-now' },
                  h('span', { className: 'label' }, t('update.versionLabel')),
                  h('code', null, view.installedVersion ?? '—'),
                ),
              ),
              supported ? null : notice('warn', h(WarnIcon, { size: 14 }), null, t('update.restartUnsupported', { reason: view.restart?.reason ?? '' })),
              view.restartError === null || view.restartError === undefined
                ? null
                : notice('error', h(WarnIcon, { size: 14 }), t('update.errorTitle'), t('update.restartFailed', { message: view.restartError })),
            ];
          }
          if (view.phase === 'restarting') {
            return h('div', { className: 'dsh-powerup-update-status' },
              h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
              t('update.restarting'),
            );
          }
          if (view.phase === 'done') {
            return [
              notice('success', h(CheckIcon, { size: 15 }), t('update.doneTitle'), view.enabled === false
                ? t('update.doneDisabled', { name: view.name, version: view.installedVersion ?? '' })
                : t('update.doneInstalled', { name: view.name, version: view.installedVersion ?? '' })),
              view.restartSkipped === true ? h('p', { key: 'restart', className: 'dsh-powerup-update-note' }, t('update.doneRestart')) : null,
              view.skippedEnable === true ? h('p', { key: 'skipped-enable', className: 'dsh-powerup-update-note' }, t('update.oneClickSkippedEnable')) : null,
              view.enableError === null || view.enableError === undefined
                ? null
                : notice('error', h(WarnIcon, { size: 14 }), t('update.errorTitle'), t('update.enableFailed', { message: view.enableError })),
              view.enableError === null || view.enableError === undefined
                ? null
                : h('p', { key: 'enable-failed', className: 'dsh-powerup-update-note' }, t('update.oneClickEnableFailed')),
              view.restartUnsupported === null || view.restartUnsupported === undefined
                ? null
                : notice('warn', h(WarnIcon, { size: 14 }), null, t('update.restartUnsupported', { reason: view.restartUnsupported })),
              view.restartError === null || view.restartError === undefined
                ? null
                : notice('error', h(WarnIcon, { size: 14 }), t('update.errorTitle'), t('update.restartFailed', { message: view.restartError })),
              view.autoClose === true
                ? h('p', { key: 'auto-close', className: 'dsh-powerup-update-note' }, t('update.doneAutoClose', { seconds: Math.round(ONE_CLICK_AUTO_CLOSE_MS / 1000) }))
                : null,
            ];
          }
          if (view.phase === 'error') {
            return [
              notice('error', h(WarnIcon, { size: 15 }), t('update.errorTitle'), view.error ?? t('update.unknown')),
              view.rolledBack === true
                ? notice('success', h(CheckIcon, { size: 15 }), t('update.rollbackOkTitle'), t('update.rollbackOkDesc', {
                  name: view.name,
                  version: view.rollbackVersion ?? view.currentVersion ?? '',
                }))
                : null,
              view.rollbackError !== undefined && view.rollbackError !== null
                ? notice('warn', h(WarnIcon, { size: 15 }), t('update.rollbackFailedTitle'), t('update.rollbackFailedDesc', { message: view.rollbackError }))
                : null,
              view.rollbackUnavailable === true
                ? notice('warn', h(WarnIcon, { size: 15 }), t('update.rollbackFailedTitle'), t('update.rollbackUnavailable'))
                : null,
              h('span', { key: 'name', className: 'dsh-powerup-update-name' }, view.name),
            ];
          }
          return null;
        })();

        const fallbackPopover = { left: 24, top: 120, width: 320, maxHeight: 260 };

        return h(React.Fragment, null,
          h('div', {
            className: 'dsh-powerup-update-mask',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) close();
            },
          },
          h('div', {
            className: 'dsh-powerup-update-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsh-powerup-update-title',
          },
          h('div', { className: 'dsh-powerup-update-head' },
            h('div', { className: 'dsh-powerup-update-heading' },
              h('h2', { id: 'dsh-powerup-update-title' }, t('update.title')),
              h('p', { title }, title),
            ),
            canClose ? h('button', { type: 'button', className: 'dsh-powerup-update-close', 'aria-label': t('update.close'), onClick: close }, '×') : null,
          ),
          h('div', { className: 'dsh-powerup-update-body' }, body),
          footer.length === 0 ? null : h('div', { className: 'dsh-powerup-update-foot' }, footer),
          ),
          ),
          view.listOpen === true
            ? h('div', {
              id: 'dsh-powerup-update-versions',
              ref: versionPanelRef,
              className: 'dsh-powerup-update-popover dsh-powerup-update-list',
              role: 'listbox',
              'aria-label': t('update.versionLabel'),
              style: view.listPopover ?? fallbackPopover,
            }, versionRows)
            : null,
          view.registryOpen === true
            ? h('div', {
              ref: registryPanelRef,
              className: 'dsh-powerup-update-popover dsh-powerup-update-select-menu',
              role: 'listbox',
              'aria-label': t('update.registry'),
              style: view.registryPopover ?? fallbackPopover,
            }, view.choices.map((choice) => {
              const isDefault = choice.key === view.defaultRegistryKey;
              const isChosen = choice.key === view.registryKey;
              return h('div', {
                key: choice.key,
                role: 'option',
                tabIndex: 0,
                className: 'dsh-powerup-update-option',
                'aria-selected': isChosen ? 'true' : 'false',
                onClick: () => chooseRegistry(choice.key),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  chooseRegistry(choice.key);
                },
              },
              h('span', { className: 'dsh-powerup-update-option-copy' },
                h('span', { className: 'dsh-powerup-update-option-title' }, choice.label),
                h('span', { className: 'dsh-powerup-update-option-host' }, choice.hint),
              ),
              isDefault
                ? h('span', { className: 'dsh-powerup-update-default-tag', title: t('update.defaultHint') }, t('update.defaultTag'))
                : h('button', {
                  type: 'button',
                  className: 'dsh-powerup-update-default',
                  title: t('update.setDefault'),
                  'aria-label': `${t('update.setDefault')} ${choice.label}`,
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDefaultRegistry(choice);
                  },
                }, h(StarIcon, { size: 12 })),
              isChosen ? h('span', { className: 'dsh-powerup-update-check' }, h(CheckIcon, { size: 13 })) : null,
              );
            }))
            : null,
        );
      }

      function buildRowItems(row, snapshot, t, sessionId, ctx, notify) {
        const text = rowText(row);
        const forkSeq = resolveForkSeq(row, snapshot);
        const quote = markdownQuote(row, t);
        const hasText = text !== '';
        const hasSession = typeof sessionId === 'string' && sessionId !== '';
        const stepId = rowStepId(row);
        const stepReference = rowStepReference(hasSession ? sessionId : '', stepId);
        return [
          {
            id: 'copy',
            label: t('menu.copy'),
            icon: h(CopyIcon, { size: 15 }),
            disabled: !hasText,
            run: async () => {
              if (!hasText) {
                notify(t('toast.empty'));
                return;
              }
              await copyText(text);
              notify(t('toast.copied'));
            },
          },
          {
            id: 'quote',
            label: t('menu.quote'),
            icon: h(QuoteIcon, { size: 15 }),
            disabled: !hasText,
            run: async () => {
              if (!hasText) {
                notify(t('toast.empty'));
                return;
              }
              await copyText(quote || text);
              notify(t('toast.copied'));
            },
          },
          {
            id: 'insert',
            label: t('menu.insert'),
            icon: h(ComposerIcon, { size: 15 }),
            disabled: !hasText,
            run: async () => {
              if (!hasText) {
                notify(t('toast.empty'));
                return;
              }
              const value = `${quote || text}\n`;
              if (insertIntoComposer(value)) {
                notify(t('toast.inserted'));
                return;
              }
              await copyText(value);
              notify(t('toast.insertFallback'));
            },
          },
          {
            id: 'inspect',
            label: t('menu.inspect'),
            icon: h(InspectIcon, { size: 15 }),
            run: async () => {
              if (row.hasAttribute('data-request-only')) {
                const requestButton = row.querySelector('button[data-label]');
                if (requestButton !== null) {
                  requestButton.click();
                  return;
                }
              }
              row.click();
            },
          },
          { type: 'separator' },
          {
            id: 'fork',
            label: t('menu.fork'),
            icon: h(ForkIcon, { size: 15 }),
            hint: forkSeq === null ? undefined : t('menu.forkHint'),
            disabled: forkSeq === null,
            title: forkSeq === null ? t('menu.noFork') : undefined,
            run: async () => {
              await forkAt(ctx, forkSeq, sessionId, notify, t);
            },
          },
          {
            id: 'stepref',
            label: t('menu.stepRef'),
            icon: h(TagIcon, { size: 15 }),
            disabled: stepReference === '',
            title: stepReference === '' ? t('menu.noStepRef') : undefined,
            run: async () => {
              if (stepReference === '') {
                notify(t('menu.noStepRef'));
                return;
              }
              await copyText(stepReference);
              notify(t('toast.stepRefCopied'));
            },
          },
          {
            id: 'session',
            label: t('menu.session'),
            icon: h(HashIcon, { size: 15 }),
            disabled: !hasSession,
            run: async () => {
              await copyText(sessionId);
              notify(t('toast.sessionCopied'));
            },
          },
        ];
      }

      function buildSessionItems(snapshot, sessionId, t, ctx, notify) {
        return [
          {
            id: 'export',
            label: t('menu.export'),
            icon: h(ExportIcon, { size: 15 }),
            disabled: snapshot === undefined || snapshot === null,
            run: async () => {
              try {
                const payload = {
                  plugin: MODULE_ID,
                  version: VERSION,
                  exportedAt: new Date().toISOString(),
                  sessionId: sessionId ?? null,
                  trajectory: jsonSafe(snapshot, new Set()),
                };
                downloadJson(`dsh-powerup-trajectory-${shortId(sessionId)}-${Date.now()}.json`, payload);
                notify(t('toast.exported'));
              } catch (error) {
                notify(format(t('toast.exportFailed'), { message: error?.message ?? String(error) }));
              }
            },
          },
          {
            id: 'session',
            label: t('menu.session'),
            icon: h(HashIcon, { size: 15 }),
            disabled: typeof sessionId !== 'string' || sessionId === '',
            run: async () => {
              await copyText(sessionId ?? '');
              notify(t('toast.sessionCopied'));
            },
          },
          { type: 'separator' },
          {
            id: 'panel',
            label: t('menu.panel'),
            icon: h(LayoutIcon, { size: 15 }),
            run: async () => {
              const layout = ctx.get('layout');
              if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel('powerup');
            },
          },
        ];
      }

      async function forkAt(ctx, seq, sessionId, notify, t) {
        const sessions = ctx?.get?.('sessions');
        if (sessions === undefined || typeof sessions.fork !== 'function') {
          notify(t('toast.forkUnavailable'));
          return;
        }
        if (typeof sessionId !== 'string' || sessionId === '') {
          notify(t('toast.noSession'));
          return;
        }
        let childId;
        try {
          childId = await sessions.fork({ sessionId, atSeq: seq, increaseTitle: true });
        } catch (error) {
          notify(format(t('toast.forkFailed'), { message: error?.message ?? String(error) }));
          return;
        }
        try {
          const workspace = ctx.get('uiWorkspace');
          if (workspace !== undefined && typeof workspace.openSession === 'function') workspace.openSession(childId);
        } catch {
          /* The fork exists even when the UI cannot open it immediately. */
        }
        notify(t('toast.forked'));
      }

      // ------------------------------------------------------------------
      // Sidebar page
      // ------------------------------------------------------------------
      function PowerUpPage({ ctx }) {
        const settings = useSettings();
        const [, forceLocale] = useState(0);
        useEffect(() => {
          const locale = ctx.get('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((value) => value + 1));
        }, [ctx]);
        const t = (key, params) => translateCurrent(key, params);
        const actions = [
          { id: 'copy', icon: CopyIcon, name: t('action.copy'), hint: t('action.copyHint') },
          { id: 'quote', icon: QuoteIcon, name: t('action.quote'), hint: t('action.quoteHint') },
          { id: 'insert', icon: ComposerIcon, name: t('action.insert'), hint: t('action.insertHint') },
          { id: 'inspect', icon: InspectIcon, name: t('action.inspect'), hint: t('action.inspectHint') },
          { id: 'fork', icon: ForkIcon, name: t('action.fork'), hint: t('action.forkHint') },
          { id: 'stepref', icon: TagIcon, name: t('action.stepRef'), hint: t('action.stepRefHint') },
          { id: 'export', icon: ExportIcon, name: t('action.export'), hint: t('action.exportHint') },
        ];
        /** One label/description row with a host-styled switch. */
        const settingRow = (key, checked, label, hint) => h('div', { key, className: 'dsh-powerup-setting' },
          h('div', { className: 'dsh-powerup-setting-copy' },
            h('span', { className: 'dsh-powerup-setting-label' }, label),
            h('span', { className: 'dsh-powerup-setting-hint' }, hint),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': label,
            className: 'dsh-powerup-switch',
            onClick: () => setSettings({ [key]: !checked }),
          },
          h('span', { className: 'dsh-powerup-switch-track' },
            h('span', { className: 'dsh-powerup-switch-thumb' }),
          ),
          h('span', null, checked ? t('page.enabled') : t('page.disabled')),
          ),
        );
        return h('div', { className: 'dsh-powerup-page' },
          h('div', { className: 'dsh-powerup-shell' },
            h('header', { className: 'dsh-powerup-hero' },
              h('div', { className: 'dsh-powerup-hero-art' }, h(BrandMark, { size: 64 })),
              h('div', { className: 'dsh-powerup-hero-copy' },
                h('h1', null, t('page.title')),
                h('p', null, t('page.subtitle')),
              ),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('div', { className: 'dsh-powerup-card-head' },
                h('div', { className: 'dsh-powerup-card-icon' }, h(PowerUpLineIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.featureTitle')),
                  h('p', null, t('page.featureDesc')),
                ),
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': settings.enabled ? 'true' : 'false',
                  'aria-label': t('page.featureTitle'),
                  className: 'dsh-powerup-switch',
                  onClick: () => setSettings({ enabled: !settings.enabled }),
                },
                h('span', { className: 'dsh-powerup-switch-track' },
                  h('span', { className: 'dsh-powerup-switch-thumb' }),
                ),
                h('span', null, settings.enabled ? t('page.enabled') : t('page.disabled')),
                ),
              ),
              h('div', { style: { marginTop: '14px' } },
                h('h3', { className: 'dsh-powerup-section-title' }, t('page.actions')),
                h('ul', { className: 'dsh-powerup-actions' },
                  actions.map((action) => h('li', { key: action.id, className: 'dsh-powerup-action' },
                    h('span', { className: 'dsh-powerup-action-icon' }, h(action.icon, { size: 15 })),
                    h('span', { className: 'dsh-powerup-action-copy' },
                      h('span', { className: 'dsh-powerup-action-name' }, action.name),
                      h('span', { className: 'dsh-powerup-action-hint' }, action.hint),
                    ),
                  )),
                ),
              ),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('div', { className: 'dsh-powerup-card-head' },
                h('div', { className: 'dsh-powerup-card-icon' }, h(LauncherIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.launcherTitle')),
                  h('p', null, t('page.launcherDesc')),
                ),
              ),
              h('div', { className: 'dsh-powerup-settings' },
                settingRow('launcher', settings.launcher !== false, t('page.launcherToggle'), t('page.launcherToggleHint')),
              ),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('div', { className: 'dsh-powerup-card-head' },
                h('div', { className: 'dsh-powerup-card-icon' }, h(QuickIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.oneClickTitle')),
                  h('p', null, t('page.oneClickDesc')),
                ),
              ),
              h('div', { className: 'dsh-powerup-settings' },
                settingRow('oneClickEnable', settings.oneClickEnable !== false, t('page.oneClickEnable'), t('page.oneClickEnableHint')),
                settingRow('oneClickRestart', settings.oneClickRestart !== false, t('page.oneClickRestart'), t('page.oneClickRestartHint')),
              ),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('div', { className: 'dsh-powerup-card-head' },
                h('div', { className: 'dsh-powerup-card-icon' }, h(UpdateIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.updateTitle')),
                  h('p', null, t('page.updateDesc')),
                ),
              ),
              h('p', { className: 'dsh-powerup-update-note', style: { marginTop: '12px' } }, t('page.updateHow')),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('div', { className: 'dsh-powerup-card-head' },
                h('div', { className: 'dsh-powerup-card-icon' }, h(StopIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.jobStopTitle')),
                  h('p', null, t('page.jobStopDesc')),
                ),
              ),
              h('p', { className: 'dsh-powerup-update-note', style: { marginTop: '12px' } }, t('page.jobStopHow')),
            ),
            h('section', { className: 'dsh-powerup-card' },
              h('h2', { className: 'dsh-powerup-section-title', style: { marginBottom: '10px' } }, t('page.howTitle')),
              h('ol', { className: 'dsh-powerup-steps' },
                h('li', { className: 'dsh-powerup-step' },
                  h('span', { className: 'dsh-powerup-step-num' }, '1'),
                  h('span', null, t('page.how1')),
                ),
                h('li', { className: 'dsh-powerup-step' },
                  h('span', { className: 'dsh-powerup-step-num' }, '2'),
                  h('span', null, t('page.how2')),
                ),
                h('li', { className: 'dsh-powerup-step' },
                  h('span', { className: 'dsh-powerup-step-num' }, '3'),
                  h('span', null, t('page.how3')),
                ),
              ),
            ),
            h('footer', { className: 'dsh-powerup-foot' },
              h('span', null, format(t('page.footer'), { version: VERSION })),
              h('span', { className: 'dsh-powerup-dot' }),
              h('span', null, t('page.localOnly')),
            ),
          ),
        );
      }

      // ------------------------------------------------------------------
      // Translator wiring
      // ------------------------------------------------------------------
      let translateCurrent = makeFallbackTranslate();

      function bindLocale(ctx) {
        const locale = ctx.get('locale');
        if (locale === undefined || typeof locale.register !== 'function') return;
        try {
          const dispose = locale.register(NS, DICT);
          if (typeof locale.bind === 'function') translateCurrent = locale.bind(NS);
          ctx.effect(() => () => {
            translateCurrent = makeFallbackTranslate();
            try {
              dispose?.();
            } catch {
              /* Removing a dictionary must never break unload. */
            }
          }, 'dsh-powerup: dictionaries');
        } catch (error) {
          console.warn('[dsh-powerup] locale registration failed:', error?.message ?? error);
        }
      }

      // ------------------------------------------------------------------
      // Plugin body
      // ------------------------------------------------------------------
      function apply(ctx) {
        bindLocale(ctx);
        installStyles(ctx);
        installLauncher(ctx);

        const slots = ctx.get('slots');
        if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          console.warn('[dsh-powerup] slots service missing; Power-Up UI disabled');
          return;
        }

        const register = (slot, options, component, label) => {
          try {
            ctx.effect(
              () => slots.inject(slot, () => slots.register({ name: slot, ...options }, component)),
              label,
            );
          } catch (error) {
            console.warn(`[dsh-powerup] could not register ${slot}:`, error?.message ?? error);
          }
        };

        register('sidebar.panellist', {
          id: 'powerup',
          order: 30,
          label: () => translateCurrent('panel.title'),
        }, (props) => h(PowerUpLineIcon, { size: props?.size ?? 16 }), 'dsh-powerup: sidebar entry');

        register('main', { key: 'powerup' }, () => h(PowerUpPage, { ctx }), 'dsh-powerup: main page');

        register('shell.overlay', {
          id: 'powerup-context-menu',
          order: 55,
        }, () => h(PowerUpOverlay, { ctx }), 'dsh-powerup: context menu');

        register('conversation.session.header.utilities', {
          id: 'powerup-bridge',
          order: 50,
        }, PowerUpBridge, 'dsh-powerup: session bridge');

        // The update control drives the built-in plugin manager through its
        // `remote.pluginManager` namespace. Register it in a nested inject scope
        // so a late-provided service is observed instead of sampled once.
        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['remote.pluginManager'], (scope) => {
              const manager = scope.get('remote.pluginManager');
              const remote = scope.get('remote');
              const childSlots = scope.get('slots');
              if (manager === undefined || childSlots === undefined || typeof childSlots.register !== 'function') return;
              scope.effect(
                () => childSlots.inject('shell.overlay', () => childSlots.register({
                  name: 'shell.overlay',
                  id: 'powerup-plugin-update',
                  order: 56,
                }, () => h(PluginUpdateOverlay, { manager, remote, ctx: scope }))),
                'dsh-powerup: plugin update',
              );
            });
          } catch (error) {
            console.warn('[dsh-powerup] plugin update registration failed:', error?.message ?? error);
          }
        }

        // The stop-reason popover reads the Client jobs snapshot while the
        // built-in jobs panel owns the stop buttons. Wait for the jobs service
        // in a nested inject scope so a late-provided service still registers.
        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['jobs'], (scope) => {
              const jobs = scope.get('jobs');
              const childSlots = scope.get('slots');
              if (jobs === undefined || childSlots === undefined || typeof childSlots.register !== 'function') return;
              scope.effect(
                () => childSlots.inject('shell.overlay', () => childSlots.register({
                  name: 'shell.overlay',
                  id: 'powerup-job-stop',
                  order: 57,
                }, () => h(JobStopOverlay, { jobs, ctx: scope }))),
                'dsh-powerup: job stop reason',
              );
            });
          } catch (error) {
            console.warn('[dsh-powerup] job stop registration failed:', error?.message ?? error);
          }
        }
      }

      return {
        inject: ['slots', 'locale'],
        apply,
        // Exported for smoke tests only; the host never reads this.
        __test: {
          DICT,
          CSS,
          LAUNCHER_CSS,
          LAUNCHER_STORAGE_KEY,
          normalizeLauncherState,
          createLauncherCore,
          installLauncher,
          PowerUpLineIcon,
          LauncherIcon,
          UpdateIcon,
          QuickIcon,
          PowerUpBridge,
          PowerUpPage,
          PowerUpOverlay,
          PluginUpdateOverlay,
          JobStopOverlay,
          renderInBody,
          stopButtonLabel,
          resolveStopTarget,
          ensureUpdateButtons,
          ensureRestartBar,
          updateButtonLabel,
          popoverPlacement,
          rowKeyParts,
          rowRecordId,
          rowStepId,
          rowStepReference,
          resolveForkSeq,
          markdownQuote,
          jsonSafe,
          buildRowItems,
          buildSessionItems,
          sortVersions,
          versionTagKind,
          compareVersionsDesc,
          buildRegistryChoices,
          pickRegistryChoice,
          matchStoredChoice,
          readDefaultRegistry,
          writeDefaultRegistry,
          readPendingRestarts,
          lookupRegistries,
          fetchRegistryVersions,
          registryHost,
          normalizeRegistry,
          readRememberedRegistry,
          packageDisplayTitle,
          normalizeVersionInput,
          installVersion,
          readSettings,
          getSettings,
          setSettings,
          inspectReason,
          operationReason,
          restorePreviousBundle,
          runOneClickUpdate,
        },
      };
    },
  });
})();
