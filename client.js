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
      /**
       * Reusable prompts. Shape: [{id,title,text,workspaceId}] (workspaceId ''
       * = all workspaces). They live on disk, not in the browser.
       */
      /** Last prompt used per workspace, for the dropdown button label. */
      const PROMPTS_LAST_KEY = 'dsh-powerup:prompts:last:v1';
      /**
       * In-progress "new prompt" dialog text, kept in memory so closing and
       * reopening the dialog restores what the user had already typed instead
       * of resetting it. Cleared once the prompt is actually created.
       */
      const promptCreateDraft = { workspaceId: null, title: '', text: '', scope: 'current' };
      /** Fallback bucket when the hero cannot resolve an owning workspace yet. */
      const UNSCOPED_WORKSPACE = '__unscoped__';
      const VERSION = '0.11.0';
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
          'page.launcherDesc': '把左侧边栏的面板按钮变成自适应图标网格：列数跟着侧边栏宽度走，图标在上、文字在下；拖动图标可以排序，把一个图标拖到另一个图标的中间就会合成一个分组（像 Windows 开始菜单的文件夹），点分组会以浮层弹出里面的图标。网格里自带「返回会话」「重启 DSH」「关闭 DSH」三个按钮，它们和「更多」一样也能拖进分组。',
          'page.launcherToggle': '启用图标网格',
          'page.launcherToggleHint': '关闭后侧边栏恢复宿主原本的列表样式；排序与分组仍会保留。',
          'page.sessionSwitchTitle': '会话标题切换',
          'page.sessionSwitchDesc': '把会话标题变成可点击的下拉列表，列出正在运行的会话（带工作区名称前缀），点击即可切换。',
          'page.sessionSwitchHow': '打开任意会话，点击顶部的会话标题，在运行中的会话列表中选择目标会话。',
          'page.locateTitle': '定位当前会话',
          'page.locateDesc': '在工作区侧边栏的按钮栏加一个定位按钮，把当前会话在工作区列表中展开、居中显示，自动展开折叠的工作区。',
          'page.locateHow': '在工作区列表顶部点击「定位当前会话」图标按钮，当前会话所在的工作区会自动展开并滚动到视图中央。',
          'page.scrollToTopTitle': '侧边栏回到顶部',
          'page.scrollToTopDesc': '在左侧边栏「新会话」按钮旁加一个回到顶部按钮：工作区列表向下滚动后才出现，点击后左侧边栏平滑滚回最顶部。',
          'page.scrollToTopHow': '在左侧边栏向下滚动工作区列表，顶部的「新会话」旁会出现向上箭头按钮，点击即可回到顶部。',
          'scrollToTop.label': '回到顶部',
          'scrollToTop.hint': '将左侧边栏滚动回最顶部',
          'page.renderingTitle': '会话内容渲染增强',
          'page.renderingDesc': '一组让会话内容更好读的增强，当前包含「回复内容屏蔽」：按正则表达式把 Agent 回复正文中匹配的片段替换成占位符，例如隐藏内部标签、水印或重复前缀。思考过程与工具调用不会被动到，只有发给你的回复正文（含最终总结）会被处理。',
          'page.renderingHow': '在 Power-Up 设置页的「内容屏蔽」标签页管理全局规则；也可以在会话顶部的 PowerUp 标签页管理当前工作区的规则。每条规则填一个正则表达式和替换文本；替换文本留空表示直接删除匹配内容，也可点「默认值」按钮填入 [已屏蔽]。正则支持多行匹配（^/$ 匹配行首行尾，. 可跨行）。',
          'page.dualSendTitle': '双发送按钮',
          'page.dualSendDesc': '在输入框右侧增加两个发送按钮：普通发送（等待/排队）与插话发送（立即打断当前生成）。快捷键 Enter 固定为等待发送、Ctrl+Shift+Enter 固定为插话发送，不受系统「繁忙时发送行为」设置影响。',
          'page.dualSendHow': '启用后输入框里会出现两个按钮，鼠标悬停可看到各自说明；输入文字后按 Enter 排队发送，按 Ctrl+Shift+Enter 立即插话发送。',
          'mask.tab': '内容屏蔽',
          'mask.tabFeatures': '功能',
          'mask.tabWorkspace': '工作区设置',
          'mask.globalTitle': '全局屏蔽规则',
          'mask.workspaceTitle': '工作区屏蔽规则',
          'mask.hint': '每条规则是一个正则表达式；命中的片段会被替换为占位符。思考过程与工具调用不会被处理。',
          'mask.pattern': '正则表达式',
          'mask.patternPlaceholder': '例如：\\[内部[^\\]]*\\]',
          'mask.replacement': '替换为',
          'mask.replacementPlaceholder': '留空则删除匹配内容',
          'mask.useDefault': '默认值',
          'mask.useDefaultHint': '填入 [已屏蔽]',
          'mask.regex': '正则',
          'mask.regexHint': '关闭后按纯文本匹配',
          'mask.enabled': '启用',
          'mask.add': '添加规则',
          'mask.delete': '删除',
          'mask.empty': '还没有规则。',
          'mask.invalid': '正则表达式无效',
          'mask.scopeGlobal': '全局',
          'mask.scopeWorkspace': '当前工作区',
          'mask.sessionTitle': 'Power-Up 设置',
          'mask.viewTabLabel': 'PowerUp',
          'mask.sessionDesc': '管理当前工作区的 Power-Up 功能设置与内容屏蔽规则。',
          'send.wait': '等待发送',
          'send.waitHint': '排队发送（Enter）',
          'send.interrupt': '插话发送',
          'send.interruptHint': '立即打断并发送（Ctrl+Shift+Enter）',
          'send.empty': '输入为空',
          'launcher.groupDefault': '分组',
          'launcher.count': '{count} 个面板',
          'launcher.renameHint': '点击重命名',
          'launcher.dissolve': '解散分组',
          'launcher.removeItem': '移出分组',
          'launcher.backToConversation': '返回会话',
          'launcher.restart': '重启',
          'launcher.restartHint': '重启 DSH（正在运行的任务会中断）',
          'launcher.close': '关闭',
          'launcher.closeHint': '关闭 DSH（正在运行的任务会中断）',
          'sessionSwitch.title': '切换会话',
          'sessionSwitch.empty': '没有正在运行的会话',
          'sessionSwitch.hint': '点击会话标题切换',
          'sessionSwitch.defaultWorkspace': '默认工作区',
          'locate.label': '定位当前会话',
          'locate.hint': '在工作区列表中定位并居中显示当前会话',
          'close.title': '关闭 DSH？',
          'close.desc': '关闭会退出 DSH，正在运行的任务会中断。',
          'close.cancel': '取消',
          'close.confirm': '关闭 DSH',
          'close.closing': 'DSH 正在关闭…',
          'close.failed': '关闭请求失败：{message}',
          'close.unsupported': '当前运行方式无法自动关闭：{reason}',
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
          'restart.tasksTitle': '有 {count} 个任务尚未完成',
          'restart.tasksHint': '普通重启不允许中断未完成任务。可以强制停止它们后再重启。',
          'restart.forceLabel': '强制重启',
          'restart.forceCloseLabel': '强制关闭',
          'restart.resumeLabel': '重启后自动继续任务',
          'restart.resumeLabelClose': '下次打开后自动继续任务',
          'restart.resumeHint': '停止前记录这些会话，下次打开 DSH 时自动发送「继续」提示词。',
          'restart.resumePromptLabel': '继续提示词（可选）',
          'restart.resumePromptPlaceholder': '默认：继续之前未完成的任务。',
          'restart.taskLine': '会话 {id}',
          'restart.taskFallback': '未命名会话',
          'restart.forceConfirm': '强制停止并重启',
          'force.done': '已停止 {count} 个任务，将自动继续 {resumed} 个会话。',
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
          'page.taskProgressTitle': '任务进度速览',
          'page.taskProgressDesc': '在会话顶部加一个「进度」按钮，点击后用当前会话的模型在后台分析会话记录，生成结构化的任务进度并用浮层展示。调用在旁路进行，不写入会话、不打断正在运行的任务；模型会按任务类型选择清单、阶段、里程碑或任务树，并可补充一段直接渲染给用户看的内容。',
          'page.taskProgressHow': '在任意会话顶部点击「进度」按钮，面板会显示最近一次结果；首次使用点「生成进度」。生成期间可继续正常操作会话。',
          'progress.title': '任务进度',
          'progress.label': '进度',
          'progress.subtitle': '由当前会话模型在后台生成',
          'progress.hint': '还没有进度报告，点「生成进度」开始分析。',
          'progress.empty': '还没有生成过进度报告。',
          'progress.generate': '生成进度',
          'progress.refresh': '刷新进度',
          'progress.retry': '重试',
          'progress.loading': '正在后台分析会话进度…',
          'progress.close': '关闭',
          'progress.failed': '生成进度失败',
          'progress.stale': '报告已过期',
          'progress.updated': '更新于 {time}',
          'progress.history': '历史进度',
          'progress.historyEmpty': '暂无历史记录',
          'progress.viewRaw': '查看原始内容',
          'progress.rawTitle': 'AI 原始生成内容',
          'progress.rawHint': '这是模型返回的原始文本，未经解析处理。',
          'progress.copyRaw': '复制原文',
          'progress.clearHistory': '清空历史',
          'progress.clearHistoryConfirm': '确定清空全部历史进度？此操作不可撤销。',
          'progress.cleared': '历史已清空',
          'progress.requirements': '生成要求',
          'progress.tabRequirements': '要求',
          'progress.reqHint': '每条要求可设置语言、结构、必须包含的数据、额外展示区要回答的问题等；按工作区隔离，留空工作区则对所有工作区生效。生成进度时可勾选本次要应用哪些要求。',
          'progress.reqNew': '新建要求',
          'progress.reqSelect': '本次应用的要求',
          'progress.reqSelectHint': '勾选本次生成要使用要求；不选则不附加任何要求。',
          'progress.reqGlobal': '通用要求（设置页）',
          'progress.reqWorkspace': '工作区要求',
          'progress.reqSession': '会话要求',
          'progress.reqTemporary': '本次临时要求',
          'progress.reqTemporaryHint': '仅本次生成生效，不会保存。',
          'progress.reqPlaceholder': '例如：用中文回答，包含每步耗时，展示区回答「下一步做什么」',
          'progress.reqSaved': '要求已保存',
          'progress.reqEmpty': '还没有设置任何要求',
          'progress.ageWarning': '已过去 {minutes} 分钟',
          'progress.resizeHint': '拖动右下角调整窗口大小',
          'page.directAskTitle': '轻量问答按钮',
          'page.directAskDesc': '在底部输入区新增一个按钮，直接把问题发给模型。不启动 Agent，不加载系统提示词、工具和技能，仅用于简单问答，回答更快、更省 token。可在弹窗里附带文件作为上下文。',
          'page.directAskHow': '点底部输入区的闪电按钮，输入问题后发送；回答会显示在一个可开关的弹窗里。这个能力不是 Agent，不能调用工具或加载技能。',
          'page.directAskToggle': '启用轻量问答按钮',
          'page.directAskToggleHint': '关闭后底部输入区不再显示该按钮。',
          'directAsk.label': '直接问答',
          'directAsk.hint': '不启动 Agent，直接问模型（无工具/技能）',
          'directAsk.title': '轻量问答',
          'directAsk.subtitle': '不加载系统提示词、工具或技能，仅回答问题',
          'directAsk.placeholder': '输入你的问题…',
          'directAsk.send': '发送',
          'directAsk.sending': '正在回答…',
          'directAsk.attach': '添加文件上下文',
          'directAsk.attachHint': '选择文本文件，内容会作为参考附加在问题前（不会写入会话）。',
          'directAsk.removeFile': '移除',
          'directAsk.empty': '请输入问题',
          'directAsk.answer': '回答',
          'directAsk.copy': '复制回答',
          'directAsk.copied': '已复制',
          'directAsk.close': '关闭',
          'directAsk.hide': '隐藏弹窗',
          'directAsk.showHint': '输入问题开始对话；可继续追问，点「+」开启新对话，点「◷」查看历史。拖动标题栏移动窗口。',
          'directAsk.newChat': '新对话',
          'directAsk.history': '历史记录',
          'directAsk.historyEmpty': '还没有历史对话',
          'directAsk.clearHistory': '清空历史',
          'directAsk.clearHistoryConfirm': '确定清空全部问答历史？此操作不可撤销。',
          'page.promptsTitle': '工作区提示词',
          'page.promptsDesc': '为每个工作区保存可复用的提示词。开启后，新会话行的 Agent 预设右侧会出现一个下拉列表，选择即可把提示词填入输入框（可继续编辑），或点提示词右侧的发送按钮直接发出。',
          'page.promptsHow': '先启用本功能，再切到「工作区提示词」标签页创建提示词；提示词按工作区隔离，没有标题时显示开头几个字。',
          'prompts.tabFeatures': '功能列表',
          'prompts.tabManage': '提示词',
          'prompts.sectionTitle': '统一管理各工作区的提示词',
          'prompts.sectionSub': '提示词按「全局 / 当前工作区」分区，区内可自定义分组并折叠展开；未分组提示词与分组同级展示，拖拽提示词到分组标题即可移动。',
          'prompts.new': '新建提示词',
          'prompts.cancel': '取消',
          'prompts.save': '保存',
          'prompts.create': '创建',
          'prompts.edit': '编辑',
          'prompts.delete': '删除',
          'prompts.confirmDelete': '确认删除？',
          'prompts.titleLabel': '标题（可选）',
          'prompts.titlePlaceholder': '给它起个名字，留空则显示开头文字',
          'prompts.textLabel': '提示词正文',
          'prompts.textPlaceholder': '粘贴或输入一段可复用的提示词…',
          'prompts.empty': '还没有提示词，点「新建提示词」创建第一个吧。',
          'prompts.workspaceLabel': '工作区',
          'prompts.workspacePlaceholder': '例如：默认工作区；留空则对所有工作区显示',
          'prompts.anyWorkspace': '所有工作区',
          'prompts.summaryFallback': '未命名提示词',
          'prompts.saved': '提示词已保存',
          'prompts.deleted': '提示词已删除',
          'prompts.filled': '已填入输入框',
          'prompts.sent': '已发送提示词',
          'prompts.fillFailed': '填入输入框失败：{message}',
          'prompts.sendFailed': '发送失败：{message}',
          'prompts.requireText': '请输入提示词正文',
          'prompts.untitled': '未命名',
          'prompts.itemsCount': '{count} 条提示词',
          'prompts.pick': '提示词',
          'prompts.pickHint': '选择要填入输入框的提示词',
          'prompts.sendDirect': '直接发送',
          'prompts.createNew': '创建新的提示词…',
          'prompts.noPrompts': '这个工作区还没有提示词',
          'prompts.createTitle': '新建提示词',
          'prompts.editTitle': '编辑提示词',
          'prompts.editHint': '修改这条提示词的标题、可见范围与正文。',
          'prompts.createScopeHint': '这个提示词会自动归属到当前工作区；你也可以改为「所有工作区」。',
          'prompts.createFailed': '创建失败：{message}',
          'prompts.workspaceCurrent': '当前工作区',
          'prompts.workspaceNone': '未识别当前工作区，将保存到所有工作区',
          'prompts.scopeGlobal': '全局提示词',
          'prompts.scopeWorkspace': '当前工作区',
          'prompts.ungrouped': '未分组',
          'prompts.groupNew': '新建分组',
          'prompts.groupRename': '重命名',
          'prompts.groupDelete': '删除分组',
          'prompts.groupNamePlaceholder': '分组名称',
          'prompts.groupCreate': '创建分组',
          'prompts.groupConfirmDelete': '删除这个分组？其中的提示词会变为未分组，不会被删除。',
          'prompts.moveToGroup': '移动到分组',
          'prompts.moveUngrouped': '移出分组',
          'prompts.dropHint': '拖拽提示词到分组标题即可移动，拖到「未分组」可移出分组；拖到另一条提示词上可调整组内排序。',
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
          'page.launcherDesc': 'Turns the left sidebar panel buttons into an adaptive icon grid: the column count follows the sidebar width, icons sit above their labels, icons can be dragged to reorder, dropping one icon onto the middle of another forms a folder (like a Windows Start menu folder), and clicking a folder opens its contents in a flyout. The grid also carries three built-in buttons — back to conversation, restart DSH and close DSH — and they, like the host\'s "more" entry, can be dragged into a folder too.',
          'page.launcherToggle': 'Enable the icon grid',
          'page.launcherToggleHint': 'When off, the sidebar keeps the host list; order and folders are remembered.',
          'page.sessionSwitchTitle': 'Session title switcher',
          'page.sessionSwitchDesc': 'Makes the session title a clickable dropdown listing running sessions (prefixed with their workspace name); pick one to switch to it.',
          'page.sessionSwitchHow': 'Open any session, click its title in the header, and choose a target from the running-sessions list.',
          'page.locateTitle': 'Locate current session',
          'page.locateDesc': 'Adds a button to the workspace sidebar header that expands, reveals and centers the current session in the workspace list, auto-expanding collapsed workspaces.',
          'page.locateHow': 'Click the locate button in the workspace header; the workspace containing the current session expands and scrolls to the center of the view.',
          'page.scrollToTopTitle': 'Sidebar back to top',
          'page.scrollToTopDesc': 'Adds a back-to-top button next to New Session in the left sidebar: it appears once the workspace list is scrolled down, and clicking it smoothly scrolls the sidebar back to the very top.',
          'page.scrollToTopHow': 'Scroll the workspace list down in the left sidebar; an up-arrow button appears beside New Session — click it to return to the top.',
          'scrollToTop.label': 'Back to top',
          'scrollToTop.hint': 'Scroll the left sidebar back to the top',
          'page.renderingTitle': 'Conversation rendering enhancements',
          'page.renderingDesc': 'A feature set for more readable conversations. Its first sub-feature is reply masking: regular expressions replace matching fragments in Agent reply text with a placeholder, for example to hide internal tags, watermarks or repeated prefixes. Reasoning and tool calls are untouched; only reply prose (including the final summary) is processed.',
          'page.renderingHow': 'Manage global rules on the Power-Up page\'s Masking tab, or workspace rules from the PowerUp tab in a session header. Each rule has a regular expression and a replacement text; a blank replacement removes the match, or click the Default button to fill in [masked]. Regex supports multiline matching (^/$ match line boundaries, . matches newlines).',
          'page.dualSendTitle': 'Dual send buttons',
          'page.dualSendDesc': 'Adds two send buttons beside the composer: a normal (queued) send and an interrupt (steer) send. Enter always queues and Ctrl+Shift+Enter always interrupts, overriding the system busy-time send behavior.',
          'page.dualSendHow': 'Once enabled, two buttons appear in the composer with hover labels. Press Enter to queue a message, or Ctrl+Shift+Enter to interrupt the running turn with it.',
          'mask.tab': 'Masking',
          'mask.tabFeatures': 'Features',
          'mask.tabWorkspace': 'Workspace settings',
          'mask.globalTitle': 'Global masking rules',
          'mask.workspaceTitle': 'Workspace masking rules',
          'mask.hint': 'Each rule is a regular expression; matching fragments are replaced with a placeholder. Reasoning and tool calls are never touched.',
          'mask.pattern': 'Regular expression',
          'mask.patternPlaceholder': 'e.g. \\[internal[^\\]]*\\]',
          'mask.replacement': 'Replace with',
          'mask.replacementPlaceholder': 'Blank removes the match',
          'mask.useDefault': 'Default',
          'mask.useDefaultHint': 'Fill in [masked]',
          'mask.regex': 'Regex',
          'mask.regexHint': 'Off means plain-text match',
          'mask.enabled': 'Enabled',
          'mask.add': 'Add rule',
          'mask.delete': 'Delete',
          'mask.empty': 'No rules yet.',
          'mask.invalid': 'Invalid regular expression',
          'mask.scopeGlobal': 'Global',
          'mask.scopeWorkspace': 'This workspace',
          'mask.sessionTitle': 'Power-Up settings',
          'mask.viewTabLabel': 'PowerUp',
          'mask.sessionDesc': 'Manage Power-Up settings and masking rules for this workspace.',
          'send.wait': 'Send (queued)',
          'send.waitHint': 'Queue to send (Enter)',
          'send.interrupt': 'Send (interrupt)',
          'send.interruptHint': 'Interrupt and send now (Ctrl+Shift+Enter)',
          'send.empty': 'Empty input',
          'launcher.groupDefault': 'Group',
          'launcher.count': '{count} panels',
          'launcher.renameHint': 'Click to rename',
          'launcher.dissolve': 'Ungroup',
          'launcher.removeItem': 'Remove from group',
          'launcher.backToConversation': 'Back to conversation',
          'launcher.restart': 'Restart',
          'launcher.restartHint': 'Restart DSH (running tasks are interrupted)',
          'launcher.close': 'Close',
          'launcher.closeHint': 'Close DSH (running tasks are interrupted)',
          'sessionSwitch.title': 'Switch session',
          'sessionSwitch.empty': 'No running sessions',
          'sessionSwitch.hint': 'Click the session title to switch',
          'sessionSwitch.defaultWorkspace': 'Default workspace',
          'locate.label': 'Locate current session',
          'locate.hint': 'Find and center the current session in the workspace list',
          'close.title': 'Close DSH?',
          'close.desc': 'Closing quits DSH; running tasks are interrupted.',
          'close.cancel': 'Cancel',
          'close.confirm': 'Close DSH',
          'close.closing': 'DSH is closing…',
          'close.failed': 'Close request failed: {message}',
          'close.unsupported': 'This runtime cannot close itself: {reason}',
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
          'restart.tasksTitle': '{count} unfinished task(s)',
          'restart.tasksHint': 'A normal restart cannot interrupt unfinished tasks. Force-stop them first, then restart.',
          'restart.forceLabel': 'Force restart',
          'restart.forceCloseLabel': 'Force close',
          'restart.resumeLabel': 'Resume tasks after restart',
          'restart.resumeLabelClose': 'Resume tasks on next launch',
          'restart.resumeHint': 'Record these sessions before stopping; on next launch DSH sends a "continue" prompt automatically.',
          'restart.resumePromptLabel': 'Continuation prompt (optional)',
          'restart.resumePromptPlaceholder': 'Default: Continue the previous unfinished task.',
          'restart.taskLine': 'Session {id}',
          'restart.taskFallback': 'Untitled session',
          'restart.forceConfirm': 'Force-stop and restart',
          'force.done': 'Stopped {count} task(s); {resumed} session(s) will resume automatically.',
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
          'page.taskProgressTitle': 'Task progress snapshot',
          'page.taskProgressDesc': 'Adds a Progress button to the session header. Clicking it asks the current session model to analyze the session in the background and produce a structured progress report shown in a floating panel. The call is off to the side: nothing is written to the session and the running task is never interrupted. The model picks a checklist, phases, milestones, or task tree to fit the work, and may add content rendered directly in the panel.',
          'page.taskProgressHow': 'Click Progress in any session header to see the last report; on first use press Generate. You can keep working in the session while it runs.',
          'progress.title': 'Task progress',
          'progress.label': 'Progress',
          'progress.subtitle': 'Generated in the background by this session model',
          'progress.hint': 'No progress report yet. Press Generate to analyze the session.',
          'progress.empty': 'No progress report generated yet.',
          'progress.generate': 'Generate progress',
          'progress.refresh': 'Refresh progress',
          'progress.retry': 'Retry',
          'progress.loading': 'Analyzing session progress in the background…',
          'progress.close': 'Close',
          'progress.failed': 'Could not generate progress',
          'progress.stale': 'Stale report',
          'progress.updated': 'Updated at {time}',
          'progress.history': 'History',
          'progress.historyEmpty': 'No history yet',
          'progress.viewRaw': 'View raw output',
          'progress.rawTitle': 'Raw AI output',
          'progress.rawHint': 'This is the exact text returned by the model, before parsing.',
          'progress.copyRaw': 'Copy raw',
          'progress.clearHistory': 'Clear history',
          'progress.clearHistoryConfirm': 'Clear all progress history? This cannot be undone.',
          'progress.cleared': 'History cleared',
          'progress.requirements': 'Requirements',
          'progress.tabRequirements': 'Requirements',
          'progress.reqHint': 'Each requirement sets language, structure, required data, questions for the display area, etc. Scoped per workspace; a blank workspace applies everywhere. Choose which ones to apply when generating progress.',
          'progress.reqNew': 'New requirement',
          'progress.reqSelect': 'Requirements for this run',
          'progress.reqSelectHint': 'Check the requirements to apply this time; none selected means no extra requirements.',
          'progress.reqGlobal': 'Global requirements (settings)',
          'progress.reqWorkspace': 'Workspace requirements',
          'progress.reqSession': 'Session requirements',
          'progress.reqTemporary': 'One-off requirements',
          'progress.reqTemporaryHint': 'Applies to this generation only; not saved.',
          'progress.reqPlaceholder': 'e.g. Answer in Chinese, include per-step timing, answer "what is next" in the display area',
          'progress.reqSaved': 'Requirements saved',
          'progress.reqEmpty': 'No requirements configured',
          'progress.ageWarning': '{minutes} minutes elapsed',
          'progress.resizeHint': 'Drag the bottom-right corner to resize',
          'page.directAskTitle': 'Direct-ask button',
          'page.directAskDesc': 'Adds a button to the bottom composer that sends a question straight to the model. No Agent is started: no system prompt, tools or skills are loaded — just a fast, cheap answer. You can attach files as context in the dialog.',
          'page.directAskHow': 'Click the lightning button in the composer, type a question and send; the answer appears in a dialog you can show or hide. This is not an Agent — it cannot call tools or load skills.',
          'page.directAskToggle': 'Enable direct-ask button',
          'page.directAskToggleHint': 'When off, the composer button is hidden.',
          'directAsk.label': 'Direct ask',
          'directAsk.hint': 'Ask the model without an Agent (no tools or skills)',
          'directAsk.title': 'Direct ask',
          'directAsk.subtitle': 'No system prompt, tools or skills — just an answer',
          'directAsk.placeholder': 'Type your question…',
          'directAsk.send': 'Send',
          'directAsk.sending': 'Answering…',
          'directAsk.attach': 'Add file context',
          'directAsk.attachHint': 'Pick a text file; its content is attached before the question as reference (never written to the session).',
          'directAsk.removeFile': 'Remove',
          'directAsk.empty': 'Enter a question first',
          'directAsk.answer': 'Answer',
          'directAsk.copy': 'Copy answer',
          'directAsk.copied': 'Copied',
          'directAsk.close': 'Close',
          'directAsk.hide': 'Hide dialog',
          'directAsk.showHint': 'Type a question to start; follow up anytime, "+" starts a new chat, "◷" shows history. Drag the title bar to move.',
          'directAsk.newChat': 'New chat',
          'directAsk.history': 'History',
          'directAsk.historyEmpty': 'No saved conversations yet',
          'directAsk.clearHistory': 'Clear history',
          'directAsk.clearHistoryConfirm': 'Clear all Q&A history? This cannot be undone.',
          'page.promptsTitle': 'Workspace prompts',
          'page.promptsDesc': 'Save reusable prompts per workspace. When enabled, a dropdown appears next to the Agent preset in the New Session row: pick a prompt to fill the composer (still editable), or click its send button to send it right away.',
          'page.promptsHow': 'Enable this feature, then open the "Workspace prompts" tab to create prompts. Prompts are scoped per workspace; without a title the first few characters are shown.',
          'prompts.tabFeatures': 'Features',
          'prompts.tabManage': 'Prompts',
          'prompts.sectionTitle': 'Manage prompts for every workspace',
          'prompts.sectionSub': 'Prompts are split into Global / This workspace sections. Each section can have custom collapsible groups; ungrouped prompts sit beside groups, and you can drag a prompt onto a group header to move it.',
          'prompts.new': 'New prompt',
          'prompts.cancel': 'Cancel',
          'prompts.save': 'Save',
          'prompts.create': 'Create',
          'prompts.edit': 'Edit',
          'prompts.delete': 'Delete',
          'prompts.confirmDelete': 'Delete this prompt?',
          'prompts.titleLabel': 'Title (optional)',
          'prompts.titlePlaceholder': 'Give it a name; leave blank to show the first words',
          'prompts.textLabel': 'Prompt text',
          'prompts.textPlaceholder': 'Paste or type a reusable prompt…',
          'prompts.empty': 'No prompts yet. Click "New prompt" to create one.',
          'prompts.workspaceLabel': 'Workspace',
          'prompts.workspacePlaceholder': 'e.g. Default workspace; leave blank for all workspaces',
          'prompts.anyWorkspace': 'All workspaces',
          'prompts.summaryFallback': 'Untitled prompt',
          'prompts.saved': 'Prompt saved',
          'prompts.deleted': 'Prompt deleted',
          'prompts.filled': 'Filled into the composer',
          'prompts.sent': 'Prompt sent',
          'prompts.fillFailed': 'Could not fill the composer: {message}',
          'prompts.sendFailed': 'Could not send: {message}',
          'prompts.requireText': 'Enter some prompt text',
          'prompts.untitled': 'Untitled',
          'prompts.itemsCount': '{count} prompts',
          'prompts.pick': 'Prompt',
          'prompts.pickHint': 'Pick a prompt to fill the composer',
          'prompts.sendDirect': 'Send now',
          'prompts.createNew': 'Create a new prompt…',
          'prompts.noPrompts': 'No prompts for this workspace yet',
          'prompts.createTitle': 'New prompt',
          'prompts.editTitle': 'Edit prompt',
          'prompts.editHint': 'Change this prompt\'s title, scope and text.',
          'prompts.createScopeHint': 'This prompt will belong to the current workspace automatically; you can also choose "All workspaces".',
          'prompts.createFailed': 'Could not create: {message}',
          'prompts.workspaceCurrent': 'Current workspace',
          'prompts.workspaceNone': 'Current workspace unknown; it will be saved for all workspaces',
          'prompts.scopeGlobal': 'Global prompts',
          'prompts.scopeWorkspace': 'This workspace',
          'prompts.ungrouped': 'Ungrouped',
          'prompts.groupNew': 'New group',
          'prompts.groupRename': 'Rename',
          'prompts.groupDelete': 'Delete group',
          'prompts.groupNamePlaceholder': 'Group name',
          'prompts.groupCreate': 'Create group',
          'prompts.groupConfirmDelete': 'Delete this group? Its prompts stay as ungrouped and are not deleted.',
          'prompts.moveToGroup': 'Move to group',
          'prompts.moveUngrouped': 'Move out of group',
          'prompts.dropHint': 'Drag a prompt onto a group header to move it, or onto Ungrouped to take it out; drop on another prompt to reorder within the group.',
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
      /** Per-feature enable flags and one-click defaults. All default on. */
      const DEFAULT_SETTINGS = {
        contextMenu: true,
        launcher: true,
        sessionSwitch: true,
        jobStop: true,
        update: true,
        locateSession: true,
        scrollToTop: true,
        contentRendering: true,
        dualSend: false,
        workspacePrompts: true,
        taskProgress: true,
        directAsk: true,
        oneClickEnable: true,
        oneClickRestart: true,
      };

      function readSettings() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
          if (parsed !== null && typeof parsed === 'object') {
            const contextMenu = parsed.contextMenu !== undefined
              ? parsed.contextMenu !== false
              : parsed.enabled !== false;
            return {
              contextMenu,
              launcher: parsed.launcher !== false,
              sessionSwitch: parsed.sessionSwitch !== false,
              jobStop: parsed.jobStop !== false,
              update: parsed.update !== false,
              locateSession: parsed.locateSession !== false,
              scrollToTop: parsed.scrollToTop !== false,
              contentRendering: parsed.contentRendering !== false,
              dualSend: parsed.dualSend === true,
              workspacePrompts: parsed.workspacePrompts !== false,
              taskProgress: parsed.taskProgress !== false,
              directAsk: parsed.directAsk !== false,
              oneClickEnable: parsed.oneClickEnable !== false,
              oneClickRestart: parsed.oneClickRestart !== false,
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
      // Workspace prompts store. All workspaces' prompts live in ONE central
      // file (~/.dsh/dsh-powerup/prompts.json) through a Host route; each
      // record carries its own workspaceId ('' = global). The browser keeps an
      // in-memory cache of the whole list so the hero dropdown and the
      // management tab see every workspace together.
      // ------------------------------------------------------------------
      const PROMPTS_API = '/dsh-powerup/api/prompts';
      let promptsCache = [];
      let promptsLoaded = false;

      /** A group record is tagged with kind:'group'; everything else is a prompt. */
      function isGroupRecord(item) {
        return item !== null && typeof item === 'object' && item.kind === 'group';
      }

      /** Normalize an arbitrary value into a clean prompt or group record. */
      function normalizePrompt(item) {
        if (item === null || typeof item !== 'object') return null;
        if (isGroupRecord(item)) {
          return {
            id: typeof item.id === 'string' && item.id !== '' ? item.id : newId(),
            kind: 'group',
            name: typeof item.name === 'string' ? item.name : '',
            workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : '',
          };
        }
        return {
          id: typeof item.id === 'string' && item.id !== '' ? item.id : newId(),
          title: typeof item.title === 'string' ? item.title : '',
          text: typeof item.text === 'string' ? item.text : '',
          workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : '',
          groupId: typeof item.groupId === 'string' ? item.groupId : '',
        };
      }

      /** @returns {Array<{id:string,title:string,text:string,workspaceId:string,groupId:string}>} */
      function readPrompts() {
        return promptsCache.filter((item) => !isGroupRecord(item));
      }

      /** @returns {Array<{id:string,kind:'group',name:string,workspaceId:string}>} */
      function readGroups() {
        return promptsCache.filter(isGroupRecord);
      }

      /** Groups visible in a workspace: its own plus the global ones. */
      function groupsForWorkspace(list, workspaceId) {
        const id = typeof workspaceId === 'string' ? workspaceId : '';
        return (Array.isArray(list) ? list : []).filter((item) => isGroupRecord(item)
          && (item.workspaceId === '' || item.workspaceId === id));
      }

      /**
       * Load the whole central store once. The list includes every workspace's
       * prompts; callers filter by workspaceId through `promptsForWorkspace`.
       */
      async function loadPrompts() {
        if (promptsLoaded) return promptsCache;
        promptsLoaded = true;
        try {
          const response = await fetch(PROMPTS_API, { headers: { accept: 'application/json' } });
          const data = response.ok ? await response.json() : null;
          const list = data !== null && Array.isArray(data.prompts) ? data.prompts : [];
          promptsCache = list.map(normalizePrompt).filter(Boolean);
        } catch {
          /* Host unavailable: keep the last known list for this page. */
        }
        emitPrompts();
        return promptsCache;
      }

      function commitStore(next) {
        promptsCache = next;
        promptsLoaded = true;
        emitPrompts();
        fetch(PROMPTS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ prompts: next }),
        }).catch(() => {
          /* The in-memory list still works for this page. */
        });
      }

      /** Replace prompts, keeping the group records already in the cache. */
      function writePrompts(list) {
        const prompts = (Array.isArray(list) ? list : []).map(normalizePrompt).filter(Boolean);
        commitStore([...promptsCache.filter(isGroupRecord), ...prompts]);
      }

      /** Replace group records, keeping the prompts already in the cache. */
      function writeGroups(list) {
        const groups = (Array.isArray(list) ? list : []).map(normalizePrompt).filter(Boolean);
        commitStore([...groups, ...promptsCache.filter((item) => !isGroupRecord(item))]);
      }

      /** Replace the whole store (prompts and groups), e.g. after a drag move. */
      function writeAll(list) {
        commitStore((Array.isArray(list) ? list : []).map(normalizePrompt).filter(Boolean));
      }

      const promptsListeners = new Set();
      function subscribePrompts(listener) {
        promptsListeners.add(listener);
        return () => promptsListeners.delete(listener);
      }
      function emitPrompts() {
        for (const listener of [...promptsListeners]) {
          try {
            listener();
          } catch {
            /* A listener must not break the write. */
          }
        }
      }

      function newId() {
        try {
          return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        } catch {
          return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
      }

      // ------------------------------------------------------------------
      // Mask rules for the content-rendering enhancement.
      // Global rules live in localStorage (already shared by every workspace
      // in this browser). Workspace rules live in ONE central file
      // (~/.dsh/dsh-powerup/mask-rules.json) via a Host route, together with
      // every other workspace's rules; the client filters by workspaceId.
      // Both lists share one normalize/compile helper.
      // ------------------------------------------------------------------
      const MASK_RULES_KEY = 'dsh-powerup:mask-rules:v1';
      const MASK_RULES_API = '/dsh-powerup/api/mask-rules';
      const MASK_PLACEHOLDER = '[已屏蔽]';
      let globalMaskRules = readGlobalMaskRules();
      let allWorkspaceMaskRules = [];
      let maskRulesLoaded = false;
      let maskRulesWorkspace = '';
      const maskRulesListeners = new Set();

      /** Normalize one stored rule; invalid regex is kept but never compiled. */
      function normalizeMaskRule(item) {
        if (item === null || typeof item !== 'object') return null;
        return {
          id: typeof item.id === 'string' && item.id !== '' ? item.id : newId(),
          pattern: typeof item.pattern === 'string' ? item.pattern : '',
          replacement: typeof item.replacement === 'string' ? item.replacement : '',
          enabled: item.enabled !== false,
          // Existing rules predate this flag and were regexes, so default true.
          regex: item.regex !== false,
          workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : '',
          scope: item.scope === 'workspace' ? 'workspace' : 'global',
        };
      }

      function readGlobalMaskRules() {
        try {
          const parsed = JSON.parse(localStorage.getItem(MASK_RULES_KEY) || '[]');
          return Array.isArray(parsed) ? parsed.map(normalizeMaskRule).filter(Boolean) : [];
        } catch {
          return [];
        }
      }

      function writeGlobalMaskRules(list) {
        globalMaskRules = (Array.isArray(list) ? list : []).map(normalizeMaskRule).filter(Boolean);
        try {
          localStorage.setItem(MASK_RULES_KEY, JSON.stringify(globalMaskRules));
        } catch {
          /* Private mode: the in-memory list still works this page. */
        }
        emitMaskRules();
      }

      /** Workspace rules belonging to one workspace id. */
      function workspaceRulesFor(id) {
        const ws = typeof id === 'string' ? id : '';
        return allWorkspaceMaskRules.filter((rule) => rule.workspaceId === ws);
      }

      /** Load the whole central rules file once (all workspaces). */
      async function loadWorkspaceMaskRules() {
        if (maskRulesLoaded) return allWorkspaceMaskRules;
        maskRulesLoaded = true;
        try {
          const response = await fetch(MASK_RULES_API, { headers: { accept: 'application/json' } });
          const data = response.ok ? await response.json() : null;
          const rules = data !== null && Array.isArray(data.rules) ? data.rules : [];
          allWorkspaceMaskRules = rules.map(normalizeMaskRule).filter(Boolean)
            .map((rule) => ({ ...rule, scope: 'workspace', workspaceId: rule.workspaceId ?? '' }));
        } catch {
          /* Host unavailable: keep the last known list. */
        }
        emitMaskRules();
        return allWorkspaceMaskRules;
      }

      /** Replace the rules of one workspace, leaving other workspaces intact. */
      function writeWorkspaceMaskRules(list, workspaceId) {
        const ws = typeof workspaceId === 'string' ? workspaceId : maskRulesWorkspace;
        const next = (Array.isArray(list) ? list : []).map(normalizeMaskRule).filter(Boolean)
          .map((rule) => ({ ...rule, scope: 'workspace', workspaceId: ws }));
        allWorkspaceMaskRules = [
          ...allWorkspaceMaskRules.filter((rule) => rule.workspaceId !== ws),
          ...next,
        ];
        maskRulesLoaded = true;
        emitMaskRules();
        fetch(MASK_RULES_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ rules: allWorkspaceMaskRules }),
        }).catch(() => {
          /* The in-memory list still works this page. */
        });
      }

      function subscribeMaskRules(listener) {
        maskRulesListeners.add(listener);
        return () => maskRulesListeners.delete(listener);
      }
      function emitMaskRules() {
        for (const listener of [...maskRulesListeners]) {
          try { listener(); } catch { /* one listener must not break the rest */ }
        }
      }

      /** Rules that apply to the current workspace: global plus its own. */
      function activeMaskRules() {
        const ws = typeof maskRulesWorkspace === 'string' ? maskRulesWorkspace : '';
        return [...globalMaskRules, ...workspaceRulesFor(ws)]
          .filter((rule) => rule.enabled && rule.pattern !== '');
      }

      /** Escape a literal string so it can be used as an exact regex source. */
      function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      }

      /**
       * Compile rules once per change into reusable RegExp objects. Regex mode
       * uses 'g' (all), 'u' (unicode), 'm' (^/$ per line) and 's' (dot crosses
       * newlines); plain-text mode escapes the pattern for a literal match.
       */
      function compileMaskRules(list) {
        const compiled = [];
        for (const rule of Array.isArray(list) ? list : []) {
          if (rule === null || rule.enabled === false || typeof rule.pattern !== 'string' || rule.pattern === '') continue;
          const isRegex = rule.regex !== false;
          try {
            compiled.push({
              re: isRegex ? new RegExp(rule.pattern, 'gums') : new RegExp(escapeRegExp(rule.pattern), 'gu'),
              // A blank replacement is intentional: remove the matched text.
              replacement: typeof rule.replacement === 'string' ? rule.replacement : '',
            });
          } catch {
            /* Invalid regex is skipped, never throws into rendering. */
          }
        }
        return compiled;
      }

      /** Apply compiled rules to one text fragment; safe for any string. */
      function applyMaskRules(text, compiled) {
        if (typeof text !== 'string' || text === '' || compiled.length === 0) return text;
        let out = text;
        for (const rule of compiled) {
          out = out.replace(rule.re, rule.replacement);
        }
        return out;
      }

      /**
       * A prompt is visible in a workspace when it is global ('') or scoped to
       * that exact workspace. The dropdown never shows prompts of other workspaces.
       */
      function promptsForWorkspace(list, workspaceId) {
        const id = typeof workspaceId === 'string' ? workspaceId : '';
        return (Array.isArray(list) ? list : []).filter((item) => !isGroupRecord(item)
          && (item.workspaceId === '' || item.workspaceId === id));
      }

      /**
       * Build the grouped view for one scope: custom groups first (in store
       * order), then ungrouped prompts as a peer group with id ''. Only prompts
       * whose groupId resolves to a group of the same scope are placed; an
       * orphaned groupId falls back to ungrouped so no prompt disappears.
       */
      function groupPrompts(prompts, groups, scopeId) {
        const scopeGroups = (Array.isArray(groups) ? groups : [])
          .filter((group) => group.workspaceId === scopeId);
        const scopePrompts = (Array.isArray(prompts) ? prompts : [])
          .filter((prompt) => prompt.workspaceId === scopeId);
        const known = new Set(scopeGroups.map((group) => group.id));
        const buckets = new Map(scopeGroups.map((group) => [group.id, []]));
        const loose = [];
        for (const prompt of scopePrompts) {
          const gid = typeof prompt.groupId === 'string' ? prompt.groupId : '';
          if (gid !== '' && buckets.has(gid)) buckets.get(gid).push(prompt);
          else loose.push(prompt);
        }
        const sections = scopeGroups.map((group) => ({
          id: group.id, name: group.name, group, items: buckets.get(group.id), isUngrouped: false,
        }));
        sections.push({ id: '', name: '', items: loose, isUngrouped: true });
        return sections;
      }

      /** Title, else the first characters of the body, else a localized fallback. */
      function promptLabel(prompt, t) {
        if (prompt === null || typeof prompt !== 'object') return '';
        const title = typeof prompt.title === 'string' ? prompt.title.trim() : '';
        if (title !== '') return title;
        const text = typeof prompt.text === 'string' ? prompt.text.trim() : '';
        if (text !== '') return [...text].slice(0, 18).join('') + (text.length > 18 ? '…' : '');
        return t('prompts.summaryFallback');
      }

      function usePrompts() {
        const [value, setValue] = useState(readPrompts);
        useEffect(() => subscribePrompts(() => setValue(readPrompts())), []);
        useEffect(() => { void loadPrompts(); }, []);
        return value;
      }

      function usePromptGroups() {
        const [value, setValue] = useState(readGroups);
        useEffect(() => subscribePrompts(() => setValue(readGroups())), []);
        useEffect(() => { void loadPrompts(); }, []);
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
      /** Tile key of the host's "more panels" launcher. */
      const LAUNCHER_MORE_KEY = '__more';
      /** Tile key of the Power-Up "back to conversation" tile. */
      const LAUNCHER_CHAT_KEY = '__chat';
      /** Tile key of the Power-Up "restart DSH" tile. */
      const LAUNCHER_RESTART_KEY = '__restart';
      /** Tile key of the Power-Up "close DSH" tile. */
      const LAUNCHER_CLOSE_KEY = '__close';
      /** 16-grid chat glyph for the synthetic "back to conversation" tile. */
      const LAUNCHER_CHAT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M2.8 3.4h10.4v6.8H7.4L4.4 12.8v-2.6H2.8V3.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      /**
       * 16-grid restart glyph: a ring with the arrowhead sitting exactly on the
       * top tangent, so the wedge and the arc line up instead of floating off
       * the opening (the previous Material glyph read as detached).
       */
      const LAUNCHER_RESTART_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M11.94 5.34A4.75 4.75 0 1 1 8 3.25" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/><path d="M7.85 1.45 11 3.25 7.85 5.05Z" fill="currentColor"/></svg>';
      /** 16-grid power glyph for the synthetic "close DSH" tile. */
      const LAUNCHER_CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M8 2.9v5.2" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/><path d="M5.77 3.81A4.75 4.75 0 1 0 10.23 3.81" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/></svg>';
      /**
       * Bridge to the Plugins overlay's React restart prompt. The launcher is
       * plain DOM and cannot render React, so the overlay publishes its opener
       * here while it is mounted; the synthetic restart tile calls it and gets
       * the same confirmation, capability check and locale-aware copy.
       */
      const restartPromptBridge = { open: null };
      /** Same bridge for the "close DSH" confirmation. */
      const closePromptBridge = { open: null };

      /**
       * Last resort for a host where the Plugins overlay (and with it the
       * React app-action prompt) is not mounted: confirm with the browser and
       * ask the Host route directly. Unreachable on a normal desktop/web host,
       * where `remote.pluginManager` mounts the overlay.
       *
       * @param {{ api: string, action: 'restart' | 'close', titleKey: string, descKey: string, unsupportedKey: string, failedKey: string }} options
       */
      async function appActionWithoutPrompt(options) {
        const t = (key, params) => translateCurrent(key, params);
        try {
          const capability = await fetch(options.api, { headers: { accept: 'application/json' } })
            .then((response) => response.json());
          if (capability?.supported !== true) {
            window.alert(t(options.unsupportedKey, { reason: capability?.reason ?? '' }));
            return;
          }
          const tasks = Array.isArray(capability?.runningTasks) ? capability.runningTasks : [];
          if (window.confirm(t(options.titleKey) + ' ' + t(options.descKey)) !== true) return;
          // With unfinished tasks, the last-resort path offers the forced
          // variant through a second confirmation and resumes by default.
          let force = false;
          let resume = false;
          if (tasks.length > 0) {
            if (window.confirm(t('restart.tasksTitle', { count: tasks.length }) + '\n' + t('restart.tasksHint')) !== true) return;
            force = true;
            resume = window.confirm(t(options.action === 'close' ? 'restart.resumeLabelClose' : 'restart.resumeLabel') + '\n' + t('restart.resumeHint')) === true;
          }
          const response = await fetch(options.api, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: options.action, force, resume }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? 'HTTP ' + response.status);
        } catch (error) {
          window.alert(t(options.failedKey, { message: error?.message ?? String(error) }));
        }
      }

      function restartWithoutPrompt() {
        return appActionWithoutPrompt({
          api: UPDATE_API,
          action: 'restart',
          titleKey: 'restart.title',
          descKey: 'restart.desc',
          unsupportedKey: 'update.restartUnsupported',
          failedKey: 'update.restartFailed',
        });
      }

      function closeWithoutPrompt() {
        return appActionWithoutPrompt({
          api: CLOSE_API,
          action: 'close',
          titleKey: 'close.title',
          descKey: 'close.desc',
          unsupportedKey: 'close.unsupported',
          failedKey: 'close.failed',
        });
      }

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
       * Replace a folder entry with its members, in the folder's own order, at
       * the exact position the folder occupied. Used by "ungroup" so dissolving
       * a folder is a pure expansion and never scatters the icons to the end.
       * @param {string[]} order current top-level order
       * @param {string} folderEntry the `group:<id>` entry being dissolved
       * @param {string[]} items member keys in folder order
       * @returns {string[]} the new top-level order
       */
      function dissolveGroupOrder(order, folderEntry, items) {
        const source = Array.isArray(order) ? order : [];
        const list = source.filter((entry) => entry !== folderEntry);
        const index = source.indexOf(folderEntry);
        const members = [];
        for (const key of Array.isArray(items) ? items : []) {
          if (typeof key !== 'string' || key === '') continue;
          if (list.includes(key) || members.includes(key)) continue;
          members.push(key);
        }
        const insertAt = index < 0 ? list.length : Math.min(index, list.length);
        list.splice(insertAt, 0, ...members);
        return list;
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
        const selectConversation = typeof options.selectConversation === 'function' ? options.selectConversation : () => {};
        const openRestart = typeof options.openRestart === 'function' ? options.openRestart : () => false;
        const openClose = typeof options.openClose === 'function' ? options.openClose : () => false;

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
        let chatButton = null;
        let restartButton = null;
        let closeButton = null;
        let dropLine = null;
        let drag = null;
        let popup = null;
        let popupDrag = null;

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
            /* 0.2.2+ wraps each row in a cell element (div.panelEntry /
               span.moreAnchor) that holds the row button as its first child. */
            if (typeof child.querySelector === 'function' && child.querySelector(':scope > button') !== null) return true;
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

        /** True when a row button is the host's "More" launcher (it opens a menu). */
        function rowOpensMenu(buttonEl, wrapper) {
          if (buttonEl === null || typeof buttonEl.getAttribute !== 'function') return false;
          if (buttonEl.hasAttribute('aria-haspopup') || buttonEl.hasAttribute('aria-expanded')) return true;
          if (wrapper !== undefined && wrapper !== null && typeof wrapper.className === 'string'
            && wrapper.className.includes('moreAnchor')) return true;
          return false;
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
            if (child.hasAttribute('data-powerup-folder')
              || child.hasAttribute('data-powerup-chat')
              || child.hasAttribute('data-powerup-restart')
              || child.hasAttribute('data-powerup-close')) continue;
            if (typeof child.classList === 'object' && child.classList !== null && child.classList.contains('dsh-powerup-drop-line')) continue;
            /* A host row is either the button itself (older sidebars) or a
               wrapper that carries the row plus its unpin overlay (0.2.2+:
               `div.panelEntry` per panel, `span.moreAnchor` for More). The
               wrapper is the grid cell; its row button is the click target. */
            let gridEl = child;
            let buttonEl = null;
            if (child.tagName === 'BUTTON') buttonEl = child;
            else if (typeof child.querySelector === 'function') {
              buttonEl = child.querySelector(':scope > button[class*="panelRow"]');
              if (buttonEl === null) buttonEl = child.querySelector(':scope > button:not([class*="panelUnpin"])');
              if (buttonEl === null) buttonEl = child.querySelector(':scope > button');
              if (buttonEl === null) continue;
            } else continue;
            const label = buttonEl.getAttribute('aria-label') ?? '';
            if (label === '') continue;
            const isMore = rowOpensMenu(buttonEl, child);
            let key = isMore ? LAUNCHER_MORE_KEY : (byLabel.get(label) ?? 'label:' + label);
            if (key !== LAUNCHER_MORE_KEY && usedKeys.has(key)) {
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

        /** Refresh a synthetic tile's label and tooltip without churning text. */
        function setSyntheticLabel(button, label, hint) {
          button.setAttribute('aria-label', label);
          button.setAttribute('title', hint === undefined ? label : hint);
          const text = typeof button.querySelector === 'function' ? button.querySelector('.dsh-powerup-synth-label') : null;
          if (text !== null && text.textContent !== label) text.textContent = label;
        }

        /** Build a synthetic tile: shared grid styling, one glyph, one label. */
        function createSyntheticTile(className, attribute, icon) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dsh-powerup-synth ' + className;
          button.setAttribute(attribute, '');
          button.innerHTML = '<span class="dsh-powerup-synth-glyph" aria-hidden="true">' + icon + '</span><span class="dsh-powerup-synth-label"></span>';
          return button;
        }

        /** The synthetic "back to conversation" tile, created once and re-used. */
        function ensureChatButton() {
          if (chatButton !== null && chatButton.isConnected === true) return chatButton;
          const button = createSyntheticTile('dsh-powerup-chat', 'data-powerup-chat', LAUNCHER_CHAT_ICON);
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (drag !== null && drag.active) return;
            closePopup();
            try {
              selectConversation();
            } catch (error) {
              warn('conversation could not be selected:', error);
            }
          });
          nav.appendChild(button);
          chatButton = button;
          return button;
        }

        /**
         * The synthetic "restart DSH" tile, created once and re-used. It hands
         * the click to the React restart prompt owned by the Plugins overlay,
         * so the sidebar and the pending-restart bar share one confirmation.
         */
        function ensureRestartButton() {
          if (restartButton !== null && restartButton.isConnected === true) return restartButton;
          const button = createSyntheticTile('dsh-powerup-restart', 'data-powerup-restart', LAUNCHER_RESTART_ICON);
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (drag !== null && drag.active) return;
            closePopup();
            try {
              if (openRestart() === false) warn('the restart prompt is not available in this host');
            } catch (error) {
              warn('restart prompt could not be opened:', error);
            }
          });
          nav.appendChild(button);
          restartButton = button;
          return button;
        }

        /**
         * The synthetic "close DSH" tile. Like the restart tile it opens the
         * React confirmation owned by the Plugins overlay (same dialog, its own
         * route), so closing asks before ending the app.
         */
        function ensureCloseButton() {
          if (closeButton !== null && closeButton.isConnected === true) return closeButton;
          const button = createSyntheticTile('dsh-powerup-close', 'data-powerup-close', LAUNCHER_CLOSE_ICON);
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (drag !== null && drag.active) return;
            closePopup();
            try {
              if (openClose() === false) warn('the close prompt is not available in this host');
            } catch (error) {
              warn('close prompt could not be opened:', error);
            }
          });
          nav.appendChild(button);
          closeButton = button;
          return button;
        }

        /** The synthetic tile buttons, for drag candidates and hit-testing. */
        function syntheticTileButtons() {
          return new Map([
            [LAUNCHER_CHAT_KEY, chatButton],
            [LAUNCHER_RESTART_KEY, restartButton],
            [LAUNCHER_CLOSE_KEY, closeButton],
          ]);
        }

        /**
         * Full tile records for the synthetic tiles, so a folder can list,
         * stack and open them exactly like a host panel row.
         */
        function syntheticTileRecords() {
          const records = new Map();
          const add = (key, button, label, glyph, active) => {
            if (button === null || button.isConnected !== true) return;
            records.set(key, {
              key,
              label,
              glyphHtml: glyph,
              buttonEl: button,
              gridEl: button,
              isMore: false,
              active: active === true,
            });
          };
          add(LAUNCHER_CHAT_KEY, chatButton, t('launcher.backToConversation'), LAUNCHER_CHAT_ICON,
            hostTiles.every((tile) => tile.active !== true));
          add(LAUNCHER_RESTART_KEY, restartButton, t('launcher.restart'), LAUNCHER_RESTART_ICON);
          add(LAUNCHER_CLOSE_KEY, closeButton, t('launcher.close'), LAUNCHER_CLOSE_ICON);
          return records;
        }

        /** Host rows plus synthetic tiles; folders can hold either kind. */
        function tileMap() {
          return new Map([...syntheticTileRecords(), ...tileByKeyMap()]);
        }

        /**
         * Apply the shared state (label, visibility, grid position) to one
         * synthetic tile. A tile that a folder hides disappears from the grid.
         */
        function syncSyntheticTile(button, key, label, hint, wide, memberOf, orderIndex) {
          setSyntheticLabel(button, label, hint);
          button.style.display = wide && !memberOf.has(key) ? '' : 'none';
          const position = orderIndex.get(key);
          button.style.order = position === undefined ? '' : String(position);
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
          if (chatButton !== null) chatButton.style.display = 'none';
          if (restartButton !== null) restartButton.style.display = 'none';
          if (closeButton !== null) closeButton.style.display = 'none';
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
            const panelKeys = [LAUNCHER_CHAT_KEY, LAUNCHER_RESTART_KEY, LAUNCHER_CLOSE_KEY, ...hostTiles.map((tile) => tile.key)];
            if (pendingLoad) {
              pendingLoad = false;
              state = normalizeLauncherState(readPersisted(), panelKeys);
            } else {
              state = normalizeLauncherState(state, panelKeys);
            }
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
              const position = orderIndex.get(tile.key);
              tile.gridEl.style.order = position === undefined ? '' : String(position);
              if (tile.active) tile.gridEl.setAttribute('data-powerup-active', '');
              else tile.gridEl.removeAttribute('data-powerup-active');
            }
            const chat = ensureChatButton();
            syncSyntheticTile(chat, LAUNCHER_CHAT_KEY, t('launcher.backToConversation'), undefined, wide, memberOf, orderIndex);
            chat.classList.toggle('is-active', hostTiles.every((tile) => tile.active !== true));
            const restart = ensureRestartButton();
            syncSyntheticTile(restart, LAUNCHER_RESTART_KEY, t('launcher.restart'), t('launcher.restartHint'), wide, memberOf, orderIndex);
            const close = ensureCloseButton();
            syncSyntheticTile(close, LAUNCHER_CLOSE_KEY, t('launcher.close'), t('launcher.closeHint'), wide, memberOf, orderIndex);
            const tiles = tileMap();
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
            if (popup !== null && popupDrag === null) {
              if (state.groups[popup.groupId] === undefined) closePopup();
              else refreshPopup();
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
          endPopupDrag();
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

        function popupSignature(group) {
          return group.name + '\u0000' + group.items.join('\u0000');
        }

        /** Re-render the flyout only when its roster or name actually changed. */
        function refreshPopup() {
          if (popup === null) return;
          const group = state.groups[popup.groupId];
          if (group === undefined) {
            closePopup();
            return;
          }
          if (popup.signature === popupSignature(group)) {
            positionPopup();
            return;
          }
          renderPopup();
        }

        function renderPopup() {
          if (popup === null) return;
          const group = state.groups[popup.groupId];
          if (group === undefined) {
            closePopup();
            return;
          }
          popup.signature = popupSignature(group);
          const element = popup.element;
          element.textContent = '';
          const head = document.createElement('div');
          head.className = 'dsh-powerup-folder-pop-head';          const title = document.createElement('button');
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
          const tiles = tileMap();
          for (const key of group.items) {
            const tile = tiles.get(key);
            if (tile === undefined) continue;
            const item = document.createElement('div');
            item.className = 'dsh-powerup-folder-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', tile.label);
            item.setAttribute('data-powerup-item', key);
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
            item.addEventListener('pointerdown', onPopupItemPointerDown);
            item.addEventListener('click', () => {
              if (popupDrag !== null && popupDrag.moved === true) return;
              selectPanel(tile);
            });
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

        // ----------------------------------------------------------------
        // Drag inside the flyout: reorder members, or drag one out to the grid
        // ----------------------------------------------------------------
        function popupItemElements() {
          if (popup === null) return [];
          return [...popup.element.querySelectorAll('.dsh-powerup-folder-item')];
        }

        function onPopupItemPointerDown(event) {
          if (popup === null) return;
          if (event.button !== undefined && event.button !== 0) return;
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== 'function') return;
          if (target.closest('.dsh-powerup-folder-item-remove') !== null) return;
          const item = target.closest('.dsh-powerup-folder-item');
          if (item === null) return;
          const key = item.getAttribute('data-powerup-item');
          if (key === null || key === '') return;
          popupDrag = {
            groupId: popup.groupId,
            key,
            item,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            moved: false,
            outside: false,
            ghost: null,
            offsetX: 0,
            offsetY: 0,
          };
          document.addEventListener('pointermove', onPopupItemMove, { capture: true, passive: false });
          document.addEventListener('pointerup', onPopupItemUp, true);
          document.addEventListener('pointercancel', onPopupItemUp, true);
        }

        function beginPopupDrag() {
          if (popupDrag === null || popup === null) return;
          popupDrag.active = true;
          popupDrag.moved = true;
          const rect = popupDrag.item.getBoundingClientRect();
          const ghost = popupDrag.item.cloneNode(true);
          ghost.className = 'dsh-powerup-folder-item-ghost';
          ghost.removeAttribute('data-powerup-item');
          ghost.style.width = rect.width + 'px';
          ghost.style.height = rect.height + 'px';
          ghost.style.left = rect.left + 'px';
          ghost.style.top = rect.top + 'px';
          document.body.appendChild(ghost);
          popupDrag.ghost = ghost;
          popupDrag.offsetX = popupDrag.startX - rect.left;
          popupDrag.offsetY = popupDrag.startY - rect.top;
          popupDrag.item.classList.add('is-dragging');
          popup.element.classList.add('is-reordering');
        }

        function onPopupItemMove(event) {
          if (popupDrag === null || popup === null) return;
          if (!popupDrag.active) {
            const dx = event.clientX - popupDrag.startX;
            const dy = event.clientY - popupDrag.startY;
            if (Math.sqrt(dx * dx + dy * dy) < 5) return;
            beginPopupDrag();
          }
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (popupDrag.ghost !== null) {
            popupDrag.ghost.style.left = Math.round(event.clientX - popupDrag.offsetX) + 'px';
            popupDrag.ghost.style.top = Math.round(event.clientY - popupDrag.offsetY) + 'px';
          }
          const rect = popup.element.getBoundingClientRect();
          const outside = event.clientX < rect.left - 12 || event.clientX > rect.right + 12
            || event.clientY < rect.top - 12 || event.clientY > rect.bottom + 12;
          if (outside !== popupDrag.outside) {
            popupDrag.outside = outside;
            popup.element.classList.toggle('is-dragging-out', outside);
          }
          if (outside) return;
          const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null;
          const targetItem = hit !== null && hit !== undefined && typeof hit.closest === 'function' ? hit.closest('.dsh-powerup-folder-item') : null;
          if (targetItem === null || targetItem === popupDrag.item || popup.element.contains(targetItem) !== true) return;
          const targetRect = targetItem.getBoundingClientRect();
          const centerX = targetRect.left + targetRect.width / 2;
          const centerY = targetRect.top + targetRect.height / 2;
          /* Same row → compare along the row; another row → compare vertically. */
          const sameRow = Math.abs(event.clientY - centerY) <= targetRect.height / 2;
          const before = sameRow ? event.clientX < centerX : event.clientY < centerY;
          const grid = targetItem.parentNode;
          if (grid === null) return;
          if (before) grid.insertBefore(popupDrag.item, targetItem);
          else grid.insertBefore(popupDrag.item, targetItem.nextSibling);
        }

        function endPopupDrag() {
          document.removeEventListener('pointermove', onPopupItemMove, { capture: true, passive: false });
          document.removeEventListener('pointerup', onPopupItemUp, true);
          document.removeEventListener('pointercancel', onPopupItemUp, true);
          if (popupDrag !== null) {
            if (popupDrag.ghost !== null) popupDrag.ghost.remove();
            if (popupDrag.item !== undefined) popupDrag.item.classList.remove('is-dragging');
            if (popup !== null) popup.element.classList.remove('is-reordering', 'is-dragging-out');
          }
          popupDrag = null;
        }

        function onPopupItemUp() {
          if (popupDrag === null) return;
          const data = popupDrag;
          const active = data.active;
          const outside = data.outside;
          endPopupDrag();
          if (!active) return;
          suppressNextClick();
          if (popup === null) return;
          if (outside) {
            if (detachFromGroup(data.groupId, data.key)) {
              closePopup();
              sync();
            }
            return;
          }
          const group = state.groups[data.groupId];
          if (group === undefined) return;
          const items = popupItemElements()
            .map((element) => element.getAttribute('data-powerup-item'))
            .filter((key) => typeof key === 'string' && key !== '');
          if (items.length !== group.items.length) {
            renderPopup();
            return;
          }
          state = { order: state.order, groups: { ...state.groups, [data.groupId]: { ...group, items } } };
          save();
          sync();
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

        /**
         * Activate one grid or folder flyout tile. The host's "more" row is
         * wrapped in a Menu root; when a folder hides it, the menu would anchor
         * to a zero-sized element, so briefly restore its box (transparent) and
         * let the host open the menu near the grid, then hide it again.
         */
        function selectPanel(tile) {
          try {
            const hiddenMore = tile.isMore === true
              && tile.gridEl !== undefined
              && typeof tile.gridEl.style === 'object'
              && tile.gridEl.style.display === 'none';
            if (hiddenMore) {
              const element = tile.gridEl;
              const restore = { display: element.style.display, opacity: element.style.opacity, pointerEvents: element.style.pointerEvents };
              element.style.display = '';
              element.style.opacity = '0';
              element.style.pointerEvents = 'none';
              if (typeof element.getBoundingClientRect === 'function') void element.getBoundingClientRect();
              tile.buttonEl.click();
              const reset = () => {
                element.style.display = restore.display;
                element.style.opacity = restore.opacity;
                element.style.pointerEvents = restore.pointerEvents;
              };
              if (typeof window !== 'undefined' && window !== null && typeof window.setTimeout === 'function') window.setTimeout(reset, 400);
              else reset();
            } else {
              tile.buttonEl.click();
            }
          } catch (error) {
            warn('panel could not be selected:', error);
          }
          closePopup();
        }

        /**
         * Take one member out of a folder and put it back on the grid right
         * after the folder (the folder dissolves when it becomes empty).
         * @returns {boolean} whether the member was removed.
         */
        function detachFromGroup(groupId, key) {
          if (groupId === null || typeof groupId !== 'string' || typeof key !== 'string') return false;
          const group = state.groups[groupId];
          if (group === undefined) return false;
          const items = group.items.filter((entry) => entry !== key);
          const groups = { ...state.groups };
          const folderEntry = launcherGroupEntry(groupId);
          let order = state.order.filter((entry) => entry !== key);
          const folderIndex = order.indexOf(folderEntry);
          if (items.length === 0) {
            delete groups[groupId];
            order = order.filter((entry) => entry !== folderEntry);
            if (folderIndex >= 0) order.splice(folderIndex, 0, key);
            else order.push(key);
          } else {
            groups[groupId] = { ...group, items };
            const insertAt = folderIndex >= 0 ? folderIndex + 1 : order.length;
            order.splice(insertAt, 0, key);
          }
          state = { order: dedupeEntries(order), groups };
          save();
          return true;
        }

        function removeFromGroup(groupId, key) {
          if (!detachFromGroup(groupId, key)) return;
          sync();
        }

        function dissolveGroup(groupId) {
          if (groupId === null || typeof groupId !== 'string') return;
          const group = state.groups[groupId];
          if (group === undefined) return;
          const groups = { ...state.groups };
          delete groups[groupId];
          const order = dissolveGroupOrder(state.order, launcherGroupEntry(groupId), group.items);
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
          const synthetic = syntheticTileButtons();
          for (const entry of state.order) {
            if (entry === excludeKey) continue;
            const synth = synthetic.get(entry);
            if (synth !== undefined) {
              if (synth !== null && synth.isConnected === true && synth.style.display !== 'none') {
                candidates.push({ key: entry, el: synth, kind: 'synthetic' });
              }
              continue;
            }
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
          if (button !== null && nav !== null && nav.contains(button)) {
            const described = describeButton(button);
            if (described !== null) return described;
          }
          /* A press on the cell padding (or the unpin overlay) still belongs to
             the tile that owns the cell. */
          const cell = target.closest('[data-powerup-grid]');
          if (cell === null || nav === null || !nav.contains(cell)) return null;
          const key = cell.getAttribute('data-powerup-grid');
          const folderId = cell.getAttribute('data-powerup-folder');
          if (folderId !== null) {
            const group = state.groups[folderId];
            if (group === undefined) return null;
            return { kind: 'folder', key: launcherGroupEntry(folderId), gridEl: cell, label: group.name };
          }
          const tile = hostTiles.find((candidate) => candidate.key === key);
          if (tile === undefined) return null;
          return { kind: tile.isMore ? 'more' : 'panel', key: tile.key, gridEl: tile.gridEl, label: tile.label };
        }

        function describeButton(button) {
          if (button.hasAttribute('data-powerup-chat')) {
            return { kind: 'chat', key: LAUNCHER_CHAT_KEY, gridEl: button, label: t('launcher.backToConversation') };
          }
          if (button.hasAttribute('data-powerup-restart')) {
            return { kind: 'restart', key: LAUNCHER_RESTART_KEY, gridEl: button, label: t('launcher.restart') };
          }
          if (button.hasAttribute('data-powerup-close')) {
            return { kind: 'close', key: LAUNCHER_CLOSE_KEY, gridEl: button, label: t('launcher.close') };
          }
          const folderId = button.getAttribute('data-powerup-folder');
          if (folderId !== null) {
            const group = state.groups[folderId];
            if (group === undefined) return null;
            return { kind: 'folder', key: launcherGroupEntry(folderId), gridEl: button, label: group.name };
          }
          const tile = hostTiles.find((candidate) => candidate.buttonEl === button);
          if (tile === undefined) return null;
          return { kind: tile.isMore ? 'more' : 'panel', key: tile.key, gridEl: tile.gridEl, label: tile.label };
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
          if (chatButton !== null) {
            chatButton.remove();
            chatButton = null;
          }
          if (restartButton !== null) {
            restartButton.remove();
            restartButton = null;
          }
          if (closeButton !== null) {
            closeButton.remove();
            closeButton = null;
          }
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
            collectHostTiles,
            detectWide,
            rowOpensMenu,
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
          selectConversation: () => {
            const layout = ctx.get('layout');
            if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(null);
          },
          openRestart: () => {
            if (restartPromptBridge.open !== null) {
              restartPromptBridge.open();
              return true;
            }
            void restartWithoutPrompt();
            return true;
          },
          openClose: () => {
            if (closePromptBridge.open !== null) {
              closePromptBridge.open();
              return true;
            }
            void closeWithoutPrompt();
            return true;
          },
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
          // Keep workspace masking rules loaded for the active session so the
          // DOM mask observer can use them without the settings tab being open.
          if (typeof sessionId === 'string' && sessionId !== '') {
            const workspaces = ctxRef.current?.get?.('workspaces');
            const wsId = typeof workspaces?.list?.getSnapshot === 'function'
              ? resolveWorkspaceIdFromSnapshot(workspaces.list.getSnapshot(), sessionId)
              : '';
            if (typeof wsId === 'string' && wsId !== '' && wsId !== maskRulesWorkspace) {
              maskRulesWorkspace = wsId;
              void loadWorkspaceMaskRules();
            }
          }
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
      // Workspace prompts: hero dropdown
      // ------------------------------------------------------------------
      /**
       * Module-level channel used by the hero's "create a new prompt" action to
       * open the Power-Up page on the prompt-management tab.
       */
      const promptUi = { listeners: new Set(), pendingCreateAt: 0 };
      const CREATE_REQUEST_TTL_MS = 8000;
      function requestPromptsTab(view) {
        if (view === 'create') promptUi.pendingCreateAt = Date.now();
        try {
          const layout = ctxRef.current?.get?.('layout');
          if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel('powerup');
        } catch {
          /* Navigation is a convenience; the page is reachable from the sidebar. */
        }
        for (const listener of [...promptUi.listeners]) {
          try {
            listener(view);
          } catch {
            /* A listener must not break the others. */
          }
        }
      }
      /** Consume a fresh "create prompt" intent from the hero dropdown. */
      function consumeCreateRequest() {
        const at = promptUi.pendingCreateAt;
        if (at === 0 || Date.now() - at > CREATE_REQUEST_TTL_MS) return false;
        promptUi.pendingCreateAt = 0;
        return true;
      }
      const ctxRef = { current: null };
      function subscribePromptsTab(listener) {
        if (typeof listener !== 'function') return () => {};
        promptUi.listeners.add(listener);
        return () => {
          promptUi.listeners.delete(listener);
        };
      }

      /** Last-picked prompt id per workspace, for the trigger label. */
      function readLastPrompt(workspaceId) {
        try {
          const parsed = JSON.parse(localStorage.getItem(PROMPTS_LAST_KEY) || '{}');
          if (parsed !== null && typeof parsed === 'object' && typeof workspaceId === 'string') {
            return typeof parsed[workspaceId] === 'string' ? parsed[workspaceId] : '';
          }
        } catch {
          /* Fall through. */
        }
        return '';
      }
      function writeLastPrompt(workspaceId, id) {
        try {
          const parsed = JSON.parse(localStorage.getItem(PROMPTS_LAST_KEY) || '{}');
          const map = parsed !== null && typeof parsed === 'object' ? parsed : {};
          if (typeof workspaceId === 'string') map[workspaceId] = id;
          localStorage.setItem(PROMPTS_LAST_KEY, JSON.stringify(map));
        } catch {
          /* Non-critical: the label just falls back to the generic hint. */
        }
      }

      /**
       * Resolve the workspace a New Session belongs to from the live workspace
       * snapshot. The hero renders only with a sessionId; workspaces own it by
       * `sessionIds`, so that is the authoritative lookup.
       */
      function resolveWorkspaceIdFromSnapshot(snapshot, sessionId) {
        const items = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.items)
          ? snapshot.items
          : [];
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue;
          const ids = Array.isArray(item.sessionIds) ? item.sessionIds : [];
          if (typeof sessionId === 'string' && ids.indexOf(sessionId) !== -1) {
            return typeof item.workspaceId === 'string' ? item.workspaceId : '';
          }
        }
        return '';
      }

      /**
       * Open the prompt picker next to the hero control. Returns a disposer.
       * DOM-based like the session switcher so it survives host re-renders.
       */
      function openPromptPopover({ anchor, t, sections, collapsed, onToggleGroup, onPick, onSend, onEdit, onCreate, onDispose, placement }) {
        if (anchor === null || anchor === undefined || typeof document === 'undefined') return () => {};
        const element = document.createElement('div');
        element.className = 'dsh-powerup-prompt-pop';
        element.setAttribute('role', 'dialog');
        element.setAttribute('data-powerup-prompt-pop', '');
        document.body.appendChild(element);
        const place = () => {
          try {
            const pos = (typeof placement === 'function' ? placement : popoverPlacement)(anchor, 260, 340);
            element.style.width = pos.width + 'px';
            element.style.maxHeight = pos.maxHeight + 'px';
            element.style.left = pos.left + 'px';
            if (typeof pos.bottom === 'number') {
              element.style.bottom = pos.bottom + 'px';
              element.style.top = 'auto';
            } else {
              element.style.top = typeof pos.top === 'number' ? pos.top + 'px' : '0px';
              element.style.bottom = 'auto';
            }
          } catch {
            /* The popover still renders at its CSS default position. */
          }
        };
        const head = document.createElement('div');
        head.className = 'dsh-powerup-prompt-pop-head';
        head.textContent = t('prompts.pick');
        element.appendChild(head);
        const list = document.createElement('div');
        list.className = 'dsh-powerup-prompt-pop-list';
        const renderRow = (prompt) => {
          const row = document.createElement('div');
          row.className = 'dsh-powerup-prompt-pop-item';
          const main = document.createElement('button');
          main.type = 'button';
          main.className = 'dsh-powerup-prompt-pop-main';
          main.setAttribute('data-prompt-id', prompt.id);
          const name = document.createElement('span');
          name.className = 'dsh-powerup-prompt-pop-name';
          name.textContent = promptLabel(prompt, t);
          const preview = document.createElement('span');
          preview.className = 'dsh-powerup-prompt-pop-preview';
          preview.textContent = [...(prompt.text || '').trim()].slice(0, 40).join('');
          main.append(name, preview);
          main.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dispose();
            onPick(prompt);
          });
          const send = document.createElement('button');
          send.type = 'button';
          send.className = 'dsh-powerup-prompt-pop-send';
          send.setAttribute('data-prompt-send', prompt.id);
          send.setAttribute('aria-label', t('prompts.sendDirect'));
          send.setAttribute('title', t('prompts.sendDirect'));
          // Icon-only send action; label moved to title/aria-label above.
          send.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M2 7.5 13.5 3 9 14.5 7.4 9.2 2 7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
          send.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dispose();
            onSend(prompt);
          });
          row.append(main);
          if (typeof onEdit === 'function') {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'dsh-powerup-prompt-pop-edit';
            edit.setAttribute('data-prompt-edit', prompt.id);
            edit.setAttribute('aria-label', t('prompts.edit'));
            edit.setAttribute('title', t('prompts.edit'));
            // Icon-only edit action; label moved to title/aria-label above.
            edit.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M11.2 2.6a1.3 1.3 0 0 1 1.8 1.8L6 11.4l-2.4.6.6-2.4 7-7Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 14h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
            edit.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              dispose();
              onEdit(prompt);
            });
            row.append(edit);
          }
          row.append(send);
          return row;
        };
        const sectionsList = Array.isArray(sections) ? sections : [];
        const emptyNode = document.createElement('div');
        emptyNode.className = 'dsh-powerup-prompt-pop-empty';
        emptyNode.textContent = t('prompts.noPrompts');
        const sep = document.createElement('div');
        sep.className = 'dsh-powerup-prompt-pop-sep';
        const localCollapsed = new Set(collapsed instanceof Set ? collapsed : []);
        const renderList = () => {
          while (list.firstChild) list.removeChild(list.firstChild);
          let total = 0;
          for (const section of sectionsList) {
            for (const group of section.groups) total += group.items.length;
          }
          if (total === 0) {
            if (emptyNode.parentNode !== element) element.appendChild(emptyNode);
            if (list.parentNode === element) element.removeChild(list);
            if (sep.parentNode === element) element.removeChild(sep);
            return;
          }
          if (emptyNode.parentNode === element) element.removeChild(emptyNode);
          if (list.parentNode !== element) element.insertBefore(list, sep.parentNode === element ? sep : null);
          if (sep.parentNode !== element) element.appendChild(sep);
          for (const section of sectionsList) {
            const scopeHead = document.createElement('div');
            scopeHead.className = 'dsh-powerup-prompt-pop-scope';
            const scopeLabel = document.createElement('span');
            scopeLabel.textContent = section.label;
            scopeHead.appendChild(scopeLabel);
            list.appendChild(scopeHead);
            for (const group of section.groups) {
              if (group.items.length === 0 && !group.group) continue;
              const isUngrouped = group.isUngrouped === true;
              const key = section.key + ':' + group.id;
              const isCollapsed = localCollapsed.has(key);
              const block = document.createElement('div');
              block.className = 'dsh-powerup-prompt-pop-block';
              if (isCollapsed) block.classList.add('is-collapsed');
              if (isUngrouped) block.classList.add('is-ungrouped');
              if (isUngrouped) {
                // Ungrouped prompts sit at the same level as group headers,
                // without a label, to keep the list compact.
                for (const prompt of group.items) block.appendChild(renderRow(prompt));
                list.appendChild(block);
                continue;
              }
              const head = document.createElement('button');
              head.type = 'button';
              head.className = 'dsh-powerup-prompt-pop-group';
              head.setAttribute('data-prompt-group', key);
              head.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
              head.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
              const label = document.createElement('span');
              label.className = 'dsh-powerup-prompt-pop-group-name';
              label.textContent = group.name || t('prompts.untitled');
              const count = document.createElement('span');
              count.className = 'dsh-powerup-prompt-pop-group-count';
              count.textContent = String(group.items.length);
              head.append(label, count);
              head.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (localCollapsed.has(key)) localCollapsed.delete(key);
                else localCollapsed.add(key);
                if (typeof onToggleGroup === 'function') onToggleGroup(key, !localCollapsed.has(key));
                renderList();
              });
              block.appendChild(head);
              if (!isCollapsed) {
                const body = document.createElement('div');
                body.className = 'dsh-powerup-prompt-pop-group-body';
                for (const prompt of group.items) body.appendChild(renderRow(prompt));
                block.appendChild(body);
              }
              list.appendChild(block);
            }
          }
        };
        renderList();
        const create = document.createElement('button');
        create.type = 'button';
        create.className = 'dsh-powerup-prompt-pop-create';
        create.textContent = t('prompts.createNew');
        create.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispose();
          onCreate();
        });
        element.appendChild(create);
        place();
        const reveal = () => element.classList.add('is-open');
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
        else reveal();

        const onOutside = (event) => {
          if (element.contains(event.target)) return;
          if (anchor !== null && typeof anchor.contains === 'function' && anchor.contains(event.target)) return;
          dispose();
        };
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            dispose();
          }
        };
        const onResize = () => place();
        const onScroll = (event) => {
          if (element.contains(event.target)) return;
          place();
        };
        let disposed = false;
        function dispose() {
          if (disposed) return;
          disposed = true;
          document.removeEventListener('pointerdown', onOutside, true);
          document.removeEventListener('keydown', onKey, true);
          window.removeEventListener?.('resize', onResize, true);
          window.removeEventListener?.('scroll', onScroll, true);
          element.classList.remove('is-open');
          element.remove();
          if (typeof onDispose === 'function') onDispose();
        }
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener?.('resize', onResize, true);
        window.addEventListener?.('scroll', onScroll, true);
        return dispose;
      }

      /**
       * In-conversation prompt dialog: creates a new prompt, or edits an
       * existing one when `prompt` is passed. For creation the workspace is
       * pinned to the session's own workspace: the user may only keep it or
       * switch to "all workspaces", never pick another workspace.
       */
      function PromptCreateModal({ workspaceId, workspaceTitle, onClose, onCreated, prompt, onUpdated }) {
        const t = (key, params) => translateCurrent(key, params);
        const editing = prompt !== null && prompt !== undefined && typeof prompt === 'object';
        const fixedScope = !editing && (typeof workspaceId !== 'string' || workspaceId === '');
        if (!editing) {
          // Reopening the dialog for the same workspace restores the previous
          // draft; switching to another workspace starts from a clean slate.
          const sameWorkspace = promptCreateDraft.workspaceId === (fixedScope ? '' : workspaceId);
          if (!sameWorkspace) {
            promptCreateDraft.workspaceId = fixedScope ? '' : workspaceId;
            promptCreateDraft.title = '';
            promptCreateDraft.text = '';
            promptCreateDraft.scope = fixedScope ? 'all' : 'current';
          }
        }
        const [title, setTitle] = useState(editing ? (prompt.title || '') : promptCreateDraft.title);
        const [text, setText] = useState(editing ? (prompt.text || '') : promptCreateDraft.text);
        const [scope, setScope] = useState(editing
          ? (prompt.workspaceId && prompt.workspaceId === workspaceId ? 'current' : 'all')
          : promptCreateDraft.scope);
        const titleRef = useRef(null);
        // Close plays an exit animation first, so the dialog does not vanish
        // abruptly; the create draft is already persisted by the effect below.
        const [closing, setClosing] = useState(false);
        const closingRef = useRef(false);
        const requestClose = () => {
          if (closingRef.current) return;
          closingRef.current = true;
          setClosing(true);
          setTimeout(() => {
            try {
              onClose();
            } catch {
              /* The parent owns unmounting. */
            }
          }, 140);
        };
        useEffect(() => {
          if (editing) return;
          promptCreateDraft.title = title;
          promptCreateDraft.text = text;
          promptCreateDraft.scope = scope;
        }, [title, text, scope, editing]);
        useEffect(() => {
          try {
            // preventScroll keeps the focus from scrolling the page mid-animation.
            titleRef.current?.focus?.({ preventScroll: true });
          } catch {
            /* Focus is a nicety. */
          }
        }, []);
        useEffect(() => {
          const onKey = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              requestClose();
            }
          };
          document.addEventListener('keydown', onKey, true);
          return () => document.removeEventListener('keydown', onKey, true);
        }, []);
        const save = () => {
          const body = typeof text === 'string' ? text.trim() : '';
          if (body === '') return;
          const list = readPrompts();
          let record;
          if (editing) {
            record = {
              id: prompt.id,
              title: typeof title === 'string' ? title.trim() : '',
              text: body,
              workspaceId: scope === 'current' && typeof workspaceId === 'string' ? workspaceId : '',
            };
            const index = list.findIndex((p) => p.id === record.id);
            if (index === -1) list.push(record);
            else list[index] = record;
          } else {
            record = {
              id: newId(),
              title: typeof title === 'string' ? title.trim() : '',
              text: body,
              workspaceId: scope === 'current' && typeof workspaceId === 'string' ? workspaceId : '',
            };
            list.push(record);
          }
          writePrompts(list);
          if (!editing) {
            // The draft became a real prompt: the next dialog starts empty.
            promptCreateDraft.title = '';
            promptCreateDraft.text = '';
            promptCreateDraft.scope = fixedScope ? 'all' : 'current';
          }
          // Play the exit animation before telling the parent to unmount.
          if (!closingRef.current) {
            closingRef.current = true;
            setClosing(true);
          }
          setTimeout(() => {
            try {
              if (editing) {
                if (typeof onUpdated === 'function') onUpdated(record);
              } else if (typeof onCreated === 'function') {
                onCreated(record);
              }
            } catch {
              /* The parent owns unmounting. */
            }
          }, 140);
        };
        const fieldClass = 'dsh-powerup-prompt-input';
        const labelClass = 'dsh-powerup-prompt-field-label';
        return renderInBody(h('div', {
          className: 'dsh-powerup-prompt-modal-mask' + (closing ? ' is-closing' : ''),
          role: 'presentation',
          'data-powerup-prompt-modal-mask': '',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) requestClose();
          },
        },
          h('div', {
            className: 'dsh-powerup-prompt-modal' + (closing ? ' is-closing' : ''),
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t(editing ? 'prompts.editTitle' : 'prompts.createTitle'),
          },
            h('div', { className: 'dsh-powerup-prompt-modal-head' },
              h('div', null,
                h('div', { className: 'dsh-powerup-prompt-modal-heading' }, t(editing ? 'prompts.editTitle' : 'prompts.createTitle')),
                h('p', { className: 'dsh-powerup-prompt-modal-sub' },
                  editing ? t('prompts.editHint') : (fixedScope ? t('prompts.workspaceNone') : t('prompts.createScopeHint'))),
              ),
              h('button', {
                type: 'button',
                className: 'dsh-powerup-prompt-modal-close',
                'aria-label': t('prompts.cancel'),
                onClick: requestClose,
              }, '\u00d7'),
            ),
            h('div', { className: 'dsh-powerup-prompt-modal-body' },
              h('label', { className: 'dsh-powerup-prompt-field' },
                h('span', { className: labelClass }, t('prompts.titleLabel')),
                h('input', {
                  ref: titleRef,
                  className: fieldClass,
                  type: 'text',
                  value: title,
                  placeholder: t('prompts.titlePlaceholder'),
                  onChange: (event) => setTitle(event.target.value),
                }),
              ),
              !fixedScope
                ? h('label', { className: 'dsh-powerup-prompt-field' },
                  h('span', { className: labelClass }, t('prompts.workspaceLabel')),
                  h(WorkspaceSelect, {
                    value: scope,
                    options: [
                      { value: 'current', label: t('prompts.workspaceCurrent'), hint: workspaceTitle },
                      { value: 'all', label: t('prompts.anyWorkspace') },
                    ],
                    onChange: setScope,
                    t,
                  }),
                )
                : null,
              h('label', { className: 'dsh-powerup-prompt-field' },
                h('span', { className: labelClass }, t('prompts.textLabel')),
                h('textarea', {
                  className: fieldClass + ' dsh-powerup-prompt-textarea',
                  value: text,
                  placeholder: t('prompts.textPlaceholder'),
                  onChange: (event) => setText(event.target.value),
                }),
              ),
            ),
            h('div', { className: 'dsh-powerup-prompt-modal-foot' },
              h('button', {
                type: 'button',
                className: 'dsh-powerup-prompt-modal-cancel',
                onClick: requestClose,
              }, t('prompts.cancel')),
              h('button', {
                type: 'button',
                className: 'dsh-powerup-prompt-modal-save',
                disabled: text.trim() === '',
                onClick: save,
              }, t(editing ? 'prompts.save' : 'prompts.create')),
            ),
          ),
        ));
      }

      /**
       * Prompt picker shared by two slots: `conversation.hero.options` (new
       * session) and `conversation.input.left` (ongoing session, beside the
       * host's permission dropdown). In the composer the popover expands
       * upward and the trigger uses a compact icon-only style.
       * Choosing a prompt fills the composer; the per-row send button submits
       * immediately.
       */
      function PromptsControl({ sessionId, inputActions, useWorkspaces, useInput, variant }) {
        const settings = useSettings();
        const compact = variant === 'composer';
        const workspaceSelector = useMemo(() => (snapshot) => resolveWorkspaceIdFromSnapshot(snapshot, sessionId), [sessionId]);
        const workspaceId = typeof useWorkspaces === 'function'
          ? useWorkspaces(workspaceSelector) ?? ''
          : '';
        const prompts = usePrompts(workspaceId);
        const groups = usePromptGroups();
        const [, forceLocale] = useState(0);
        const [creating, setCreating] = useState(false);
        const [editing, setEditing] = useState(null);
        const [collapsed, setCollapsed] = useState(() => new Set());
        const anchorRef = useRef(null);
        const disposeRef = useRef(null);
        const t = (key, params) => translateCurrent(key, params);
        useEffect(() => {
          const locale = ctxRef.current?.get?.('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((value) => value + 1));
        }, []);
        useEffect(() => () => {
          if (typeof disposeRef.current === 'function') disposeRef.current();
        }, []);

        const workspaceTitle = typeof useWorkspaces === 'function'
          ? (useWorkspaces((snapshot) => {
            const items = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.items)
              ? snapshot.items : [];
            const found = items.find((item) => item !== null && typeof item === 'object'
              && typeof item.workspaceId === 'string' && item.workspaceId === workspaceId);
            return found?.title ?? '';
          }) ?? '')
          : '';
        if (!settings.workspacePrompts) return null;

        const visible = promptsForWorkspace(prompts, workspaceId);
        const sections = [];
        if (workspaceId !== '') {
          sections.push({
            key: 'global',
            label: t('prompts.scopeGlobal'),
            groups: groupPrompts(visible, groups, ''),
          });
        }
        sections.push({
          key: 'workspace',
          label: workspaceId === '' ? t('prompts.scopeGlobal') : t('prompts.scopeWorkspace'),
          groups: groupPrompts(visible, groups, workspaceId),
        });
        const toggleGroup = (key) => setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        const lastId = readLastPrompt(workspaceId);
        const last = visible.find((p) => p.id === lastId);
        const label = last !== undefined ? promptLabel(last, t) : t('prompts.pick');

        const apply = (prompt, send) => {
          const actions = inputActions;
          if (actions === null || actions === undefined || typeof actions.setDraft !== 'function') {
            console.warn('[dsh-powerup] no input actions on this session');
            return;
          }
          try {
            const text = prompt.text || '';
            // Filling should not throw away a draft the user is already typing.
            // Use a revision-guarded insertion to append as one undo step; fall
            // back to setDraft when there is no insertion face or the draft
            // changed between capture and insert.
            let inserted = false;
            if (!send && typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
              try {
                const span = actions.captureInsertion();
                inserted = actions.insertText(text, span) === true;
              } catch {
                inserted = false;
              }
            }
            if (!inserted) actions.setDraft(text);
            writeLastPrompt(workspaceId, prompt.id);
            if (send) {
              if (typeof actions.submit === 'function') actions.submit();
            } else {
              if (typeof actions.persistDraft === 'function') actions.persistDraft();
              if (typeof actions.focus === 'function') actions.focus();
            }
          } catch (error) {
            console.warn('[dsh-powerup] prompt apply failed:', error?.message ?? error);
          }
        };

        return h(React.Fragment, null,
          h('button', {
            type: 'button',
            ref: anchorRef,
            className: 'dsh-powerup-prompt-trigger' + (compact ? ' dsh-powerup-prompt-trigger-compact' : ''),
            'data-powerup-prompts': '',
            'data-powerup-prompts-variant': compact ? 'composer' : 'hero',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            title: t('prompts.pickHint'),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof disposeRef.current === 'function') {
              disposeRef.current();
              return;
            }
            const anchor = anchorRef.current;
            if (anchor === null || anchor === undefined) return;
            anchor.setAttribute('aria-expanded', 'true');
            const dispose = openPromptPopover({
              anchor,
              t,
              sections,
              collapsed,
              onToggleGroup: toggleGroup,
              placement: (node) => popoverPlacement(node, 360, 480, { preferUp: compact }),
              onPick: (prompt) => apply(prompt, false),
              onSend: (prompt) => apply(prompt, true),
              onEdit: (prompt) => setEditing(prompt),
              onCreate: () => setCreating(true),
              onDispose: () => {
                disposeRef.current = null;
                try {
                  anchor.setAttribute('aria-expanded', 'false');
                } catch {
                  /* The host may have replaced the anchor. */
                }
              },
            });
            disposeRef.current = dispose;
          },
        },
            h('span', { className: 'dsh-powerup-prompt-trigger-icon', 'aria-hidden': 'true' },
              h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
                h('path', { d: 'M3 4.5h10M3 8h10M3 11.5h6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
              ),
            ),
            h('span', { className: 'dsh-powerup-prompt-trigger-label' }, label),
            h('span', { className: 'dsh-powerup-prompt-trigger-chevron', 'aria-hidden': 'true' },
              h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none' },
                h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              ),
            ),
          ),
          creating
            ? h(PromptCreateModal, {
              workspaceId,
              workspaceTitle,
              onClose: () => setCreating(false),
              onCreated: (record) => {
                setCreating(false);
                writeLastPrompt(workspaceId, record.id);
              },
            })
            : null,
          editing
            ? h(PromptCreateModal, {
              workspaceId,
              workspaceTitle,
              prompt: editing,
              onClose: () => setEditing(null),
              onUpdated: () => setEditing(null),
            })
            : null,
        );
      }

      /** Thin wrappers so both slots share one implementation. */
      function HeroPromptsControl(props) {
        return PromptsControl({ ...props, variant: 'hero' });
      }
      function ComposerPromptsControl(props) {
        return PromptsControl({ ...props, variant: 'composer' });
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

      function LocateIcon({ size = 16 }) {
        return h(Icon, { size },
          h('circle', { cx: '8', cy: '8', r: '4.6', stroke: 'currentColor', strokeWidth: '1.3' }),
          h('circle', { cx: '8', cy: '8', r: '1.4', fill: 'currentColor' }),
          h('path', {
            d: 'M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2',
            stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
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

      function ScrollTopIcon({ size = 16 }) {
        return h(Icon, { size },
          h('path', {
            d: 'M8 12.5V3.5M4.2 7.3 8 3.5l3.8 3.8',
            fill: 'none', stroke: 'currentColor', strokeWidth: '1.4',
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M3 14h10', fill: 'none', stroke: 'currentColor',
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

      /** A radar/target glyph for the task-progress side call. */
      function ProgressIcon({ size = 16 }) {
        return h(Icon, { size },
          h('circle', { cx: '8', cy: '8', r: '5.8', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
          h('circle', { cx: '8', cy: '8', r: '2.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
          h('path', { d: 'M8 8 12.4 3.6', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
          h('circle', { cx: '8', cy: '8', r: '.9', fill: 'currentColor' }),
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
/* One grid cell per tile. A host row arrives either as a bare button or as a
   wrapper that also holds the unpin overlay (0.2.2+: div.panelEntry, and
   span.moreAnchor for More), so the cell box and the tile face are styled
   separately: the wrapper is the cell, its row button is the face. */
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid],.dsh-powerup-folder,.dsh-powerup-synth{position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:auto;min-width:0;height:auto;min-height:52px;margin:0;padding:0;border:0;border-inline:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:14px;text-align:center}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid]>button:not([class*="panelUnpin"]),nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>button[data-powerup-grid],.dsh-powerup-folder,.dsh-powerup-synth{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;flex:1 1 auto;width:100%;min-width:0;height:auto;min-height:52px;margin:0;padding:6px 2px 5px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font:inherit;font-size:11px;line-height:14px;text-align:center;cursor:pointer;user-select:none;-webkit-user-select:none;transition:background .12s ease,color .12s ease,transform .12s ease}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid]:hover,.dsh-powerup-folder:hover,.dsh-powerup-synth:hover{background:var(--dsw-alias-interactive-bg-hover)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid]:active,.dsh-powerup-folder:active,.dsh-powerup-synth:active{transform:scale(.96)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid][data-powerup-active],nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid][class*="panelEntryActive"],nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid]:has(>button[aria-expanded=true]){background:var(--dsw-alias-interactive-bg-hover)}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelUnpin"]{display:none!important}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelGlyph"]{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelGlyph"] svg{width:20px;height:20px}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide [class*="panelTitle"]{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;font-weight:400;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid]:hover [class*="panelTitle"]{color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder{position:relative;list-style:none;flex:none}
.dsh-powerup-folder-stack{display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:1px;width:24px;height:24px;padding:2px;box-sizing:border-box;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);flex:none}
.dsh-powerup-folder-mini{display:inline-flex;align-items:center;justify-content:center;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);opacity:.85}
.dsh-powerup-folder-mini svg{width:9px;height:9px}
.dsh-powerup-folder-stack.is-single{grid-template-columns:1fr;grid-template-rows:1fr}
.dsh-powerup-folder-stack.is-single .dsh-powerup-folder-mini svg{width:14px;height:14px}
.dsh-powerup-folder-name{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder.is-active .dsh-powerup-folder-name{color:var(--dsw-alias-label-primary)}
.dsh-powerup-folder.is-active .dsh-powerup-folder-stack{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent)}
.dsh-powerup-synth-glyph{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-powerup-synth-glyph svg{width:20px;height:20px}
.dsh-powerup-synth-label{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-synth:hover .dsh-powerup-synth-label{color:var(--dsw-alias-label-primary)}
.dsh-powerup-chat.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-chat.is-active .dsh-powerup-synth-label,.dsh-powerup-chat.is-active .dsh-powerup-synth-glyph{color:var(--dsw-alias-label-primary)}
.dsh-powerup-dragging{opacity:.32}
.dsh-powerup-merge-target{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 17%,transparent)!important;box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-powerup-drop-line{position:absolute;z-index:6;display:none;width:2px;border-radius:999px;background:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent);pointer-events:none}
.dsh-powerup-drag-ghost{position:fixed;z-index:1800;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 2px 5px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:14px;pointer-events:none;opacity:.96;transform:scale(1.05);transition:opacity .1s ease}
.dsh-powerup-drag-ghost>button:not([class*="panelUnpin"]){box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:100%;min-height:0;margin:0;padding:6px 2px 5px;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:14px;text-align:center;cursor:pointer;user-select:none;-webkit-user-select:none}
.dsh-powerup-drag-ghost [class*="panelGlyph"]{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}
.dsh-powerup-drag-ghost [class*="panelUnpin"]{display:none!important}
.dsh-powerup-drag-ghost [class*="panelGlyph"] svg{width:20px;height:20px}
.dsh-powerup-drag-ghost [class*="panelTitle"]{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:14px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder-pop{position:fixed;z-index:1800;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:max-content;min-width:196px;max-width:min(440px,calc(100vw - 24px));max-height:min(72vh,440px);padding:8px;border:0;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;opacity:0;transform:scale(.92);transition:opacity .13s ease,transform .17s cubic-bezier(.22,.9,.3,1.06)}
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
.dsh-powerup-folder-item[data-powerup-item]{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.dsh-powerup-folder-item.is-dragging{opacity:.3}
.dsh-powerup-folder-pop.is-reordering{overflow:visible}
.dsh-powerup-folder-pop.is-dragging-out{opacity:.7;transform:scale(.97)}
.dsh-powerup-folder-item-ghost{position:fixed;z-index:1900;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 2px 5px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:14px;pointer-events:none;opacity:.96;transform:scale(1.05)}
.dsh-powerup-folder-item-ghost .dsh-powerup-folder-item-glyph{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-powerup-folder-item-ghost .dsh-powerup-folder-item-glyph svg{width:20px;height:20px}
.dsh-powerup-folder-item-ghost .dsh-powerup-folder-item-label{display:block;width:100%;max-width:100%;color:var(--dsw-alias-label-secondary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-powerup-folder-item-ghost .dsh-powerup-folder-item-remove{display:none}
@media (prefers-reduced-motion:reduce){nav.dsh-powerup-launcher.dsh-powerup-launcher-wide>[data-powerup-grid],.dsh-powerup-folder,.dsh-powerup-synth,.dsh-powerup-folder-pop,.dsh-powerup-drag-ghost,.dsh-powerup-drop-line{transition:none}}
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
.dsh-powerup-card{margin:0 0 14px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:opacity .14s ease}
.dsh-powerup-card.is-off .dsh-powerup-card-icon,.dsh-powerup-card.is-off .dsh-powerup-card-copy{opacity:.55}
.dsh-powerup-card-head{display:flex;align-items:flex-start;gap:12px}
.dsh-powerup-card-how{margin:12px 0 0;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;overflow-wrap:anywhere}
.dsh-powerup-card-detail{margin-top:12px;padding-top:4px}
.dsh-powerup-how-card .dsh-powerup-section-title{margin-bottom:10px}
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
.dsh-powerup-menu{position:fixed;z-index:1000;min-width:232px;max-width:300px;max-height:min(70vh,430px);overflow-y:auto;padding:4px;border:0;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.4;pointer-events:auto;outline:none;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
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
.dsh-powerup-update-tasks{display:flex;flex-direction:column;gap:8px;padding:12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-update-tasks>strong{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px}
.dsh-powerup-update-task-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;margin:2px 0;padding:0;list-style:none}
.dsh-powerup-update-task-list li{display:flex;align-items:center;gap:7px;min-width:0;padding:4px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:16px}
.dsh-powerup-update-task-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsh-powerup-update-task-list code{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px}
.dsh-powerup-update-task-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warning-foreground,var(--dsw-alias-brand-primary))}
.dsh-powerup-app-check{display:flex;align-items:flex-start;gap:9px;padding:4px 0;cursor:pointer}
.dsh-powerup-app-check input{flex:none;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.dsh-powerup-app-check span{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsh-powerup-app-check strong{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:500}
.dsh-powerup-app-check small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
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

      const SESSION_SWITCH_CSS = `
[data-powerup-session-title]{cursor:pointer!important}
[data-powerup-session-title]:hover{color:var(--dsw-alias-brand-primary)}
.dsh-powerup-session-pop{position:fixed;z-index:1500;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;opacity:0;transform:translateY(-4px);transition:opacity .12s ease,transform .12s ease;pointer-events:auto}
.dsh-powerup-session-pop.is-open{opacity:1;transform:none}
.dsh-powerup-session-pop-head{flex:none;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.dsh-powerup-session-pop-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:6px}
.dsh-powerup-session-pop-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 9px;border:0;border-radius:var(--dsw-radius-md,7px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsh-powerup-session-pop-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}
.dsh-powerup-session-pop-item[data-current]{background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-session-pop-item[data-current]:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3))}
.dsh-powerup-session-pop-item:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.dsh-powerup-session-pop-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.dsh-powerup-session-pop-dot[data-status=blocked]{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-error-primary))}
.dsh-powerup-session-pop-item[data-current] .dsh-powerup-session-pop-dot[data-status=running]{background:var(--dsw-alias-brand-primary)}
.dsh-powerup-session-pop-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-session-pop-empty{padding:14px 12px;color:var(--dsw-alias-label-secondary);text-align:center}
@media (prefers-reduced-motion:reduce){.dsh-powerup-session-pop{transition:none}}
`;

      const LOCATE_CSS = `
/* The host caps the toolbar's action row at 60px (two 28px buttons plus the
4px gap) and clips the overflow, so a third button would be invisible. The
marker is only present while our button is mounted, and the host's
"search expanded" class still collapses the row. */
[data-sidebar-workspace-header] [data-powerup-locate-actions]:not([class*="headerActionsHidden"]){max-width:none}
[data-sidebar-workspace-header] .dsh-powerup-locate{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;transition:background .12s ease,color .12s ease}
[data-sidebar-workspace-header] .dsh-powerup-locate:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
[data-sidebar-workspace-header] .dsh-powerup-locate:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
[data-sidebar-workspace-header] .dsh-powerup-locate svg{width:16px;height:16px}
`;

      const SCROLL_TOP_CSS = `
/* Back-to-top button injected next to the host's New Session row. Hidden by
default; shown only while the sidebar workspace list is scrolled down. */
.dsh-powerup-scrolltop{display:none;flex:none;align-items:center;justify-content:center;width:38px;height:38px;padding:0;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;transition:background .12s ease,color .12s ease,opacity .12s ease;opacity:0}
.dsh-powerup-scrolltop[data-visible="true"]{display:inline-flex;opacity:1}
.dsh-powerup-scrolltop:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-powerup-scrolltop:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-scrolltop svg{width:16px;height:16px}
html[data-platform="darwin"] .dsh-powerup-scrolltop{background:var(--dsw-specific-sidebar-glass-fill)}
html[data-platform="darwin"] .dsh-powerup-scrolltop:hover{background:var(--dsw-specific-sidebar-glass-hover)}
@media (prefers-reduced-motion:reduce){.dsh-powerup-scrolltop{transition:none}}
`;

      const RENDERING_CSS = `
/* Masked fragments get a subtle marker so the reader knows text was hidden. */
.dsh-powerup-masked{color:var(--dsw-alias-label-caption);font-style:italic;opacity:.72}
/* Dual send buttons injected into the composer's right slot. */
.dsh-powerup-send{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dsh-powerup-send:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dsh-powerup-send:disabled{opacity:.45;cursor:not-allowed}
.dsh-powerup-send:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-send[data-kind="interrupt"]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.dsh-powerup-send svg{width:16px;height:16px}
.dsh-powerup-dual-send{display:inline-flex;align-items:center;gap:4px}
.dsh-powerup-mask-editor{display:flex;flex-direction:column;gap:10px}
.dsh-powerup-mask-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.dsh-powerup-mask-default.on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-brand-primary)}
.dsh-powerup-mask-input{width:100%;box-sizing:border-box;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
.dsh-powerup-mask-input.invalid{border-color:var(--dsw-alias-state-error-primary)}
.dsh-powerup-mask-replacement{display:flex;align-items:center;gap:4px;min-width:0}
.dsh-powerup-mask-replacement .dsh-powerup-mask-input{flex:1 1 auto;min-width:0}
.dsh-powerup-mask-default{flex:none;padding:5px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsh-powerup-mask-default:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-mask-default:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-mask-empty{color:var(--dsw-alias-label-secondary);font-size:12px}
@media (max-width:680px){.dsh-powerup-mask-row{grid-template-columns:minmax(0,1fr)}}
`;

      const PROMPTS_CSS = `
/* New Session hero: dropdown trigger, portaled popover, and per-row send. */
.dsh-powerup-prompt-trigger{display:inline-flex;align-items:center;gap:5px;max-width:190px;height:28px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dsh-powerup-prompt-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dsh-powerup-prompt-trigger[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.dsh-powerup-prompt-trigger:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-prompt-trigger-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-prompt-trigger-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-prompt-trigger-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dsh-powerup-prompt-trigger[aria-expanded=true] .dsh-powerup-prompt-trigger-chevron{transform:rotate(180deg)}
/* Compact variant in the ongoing-session composer tool row: icon + short label,
   left of the send controls, pops upward above the permission dropdown row. */
.dsh-powerup-prompt-trigger-compact{max-width:none;height:30px;padding:0 8px;font-size:11.5px}
.dsh-powerup-prompt-trigger-compact .dsh-powerup-prompt-trigger-label{max-width:96px}
.dsh-powerup-prompt-pop{position:fixed;z-index:1600;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;overflow-x:hidden;border:0;border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;opacity:0;transform:translateY(-4px);transition:opacity .12s ease,transform .12s ease;pointer-events:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-prompt-pop.is-open{opacity:1;transform:none}
.dsh-powerup-prompt-pop-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 11px 7px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:600;letter-spacing:.03em}
/* Scope dividers: a full-width label with hairline rules on both sides. */
.dsh-powerup-prompt-pop-scope{flex:none;display:flex;align-items:center;gap:8px;padding:4px 10px 2px;color:var(--dsw-alias-brand-primary);font-size:10.5px;font-weight:700;letter-spacing:.04em}
.dsh-powerup-prompt-pop-scope::before,.dsh-powerup-prompt-pop-scope::after{content:'';flex:1 1 auto;height:1px;background:var(--dsw-alias-border-l1)}
.dsh-powerup-prompt-pop-block+.dsh-powerup-prompt-pop-scope{margin-top:0}
/* One group: a tinted header chip with a compact, rail-joined body. */
.dsh-powerup-prompt-pop-block{flex:none;display:flex;flex-direction:column;gap:2px;margin:0 0 2px}
.dsh-powerup-prompt-pop-group{flex:none;display:flex;align-items:center;gap:6px;width:100%;min-height:28px;padding:3px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;font-weight:600;line-height:1.5;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.dsh-powerup-prompt-pop-group svg{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .12s ease}
.dsh-powerup-prompt-pop-group[aria-expanded=false] svg{transform:rotate(-90deg)}
.dsh-powerup-prompt-pop-group:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-pop-group-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-prompt-pop-group-count{margin-left:auto;flex:none;min-width:18px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:500;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-powerup-prompt-pop-group-body{flex:none;display:flex;flex-direction:column;gap:3px;margin-left:10px;padding-left:7px;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-powerup-prompt-pop-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:2px;padding:4px 6px;overflow-y:auto;overflow-x:hidden}
.dsh-powerup-prompt-pop-item{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;min-height:38px;padding:4px 5px 4px 9px;border:.5px solid transparent;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;transition:border-color .12s ease,background .12s ease}
.dsh-powerup-prompt-pop-item:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-pop-main{flex:1 1 auto;display:flex;flex-direction:column;gap:1px;min-width:0;padding:3px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-powerup-prompt-pop-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:18px}
.dsh-powerup-prompt-pop-preview{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.dsh-powerup-prompt-pop-send,.dsh-powerup-prompt-pop-edit{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dsh-powerup-prompt-pop-send svg,.dsh-powerup-prompt-pop-edit svg{width:14px;height:14px}
.dsh-powerup-prompt-pop-send:hover,.dsh-powerup-prompt-pop-edit:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dsh-powerup-prompt-pop-send:focus-visible,.dsh-powerup-prompt-pop-edit:focus-visible,.dsh-powerup-prompt-pop-main:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.dsh-powerup-prompt-pop-sep{flex:none;height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1)}
.dsh-powerup-prompt-pop-create{flex:none;display:flex;align-items:center;gap:7px;width:100%;min-height:32px;padding:0 10px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-powerup-prompt-pop-create:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-pop-empty{padding:12px 10px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.55;text-align:center}
/* DSH-memory-style tab bar: inline segmented control. */
.dsh-powerup-tabs{display:inline-flex;gap:2px;padding:2px;margin-bottom:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-tab{padding:4px 14px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.6;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsh-powerup-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-powerup-tab.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.10)}
.dsh-powerup-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
/* Prompt management: head + cards + fields, styled after dsh-memory setcard/hook-card. */
.dsh-powerup-prompt-head{display:flex;align-items:flex-end;gap:12px;padding:0 2px 2px}
.dsh-powerup-prompt-head-title{font-size:14px;font-weight:600;line-height:1.35}
.dsh-powerup-prompt-head-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px}
.dsh-powerup-prompt-head .dsh-powerup-prompt-new{margin-left:auto}
.dsh-powerup-prompt-new{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;cursor:pointer;transition:border-color .12s ease,color .12s ease}
.dsh-powerup-prompt-new:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-powerup-prompt-new:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsh-powerup-prompt-scopes{display:flex;flex-direction:column;gap:16px;margin-top:14px}
.dsh-powerup-prompt-scope-head{display:flex;align-items:center;gap:8px;padding:4px 2px}
.dsh-powerup-prompt-scope-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;letter-spacing:.03em}
.dsh-powerup-prompt-groups{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.dsh-powerup-prompt-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;transition:border-color .12s ease,background .12s ease}
.dsh-powerup-prompt-group.drop-target{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-group-head{display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;background:transparent}
.dsh-powerup-prompt-group-toggle{display:flex;flex:1 1 auto;align-items:center;gap:8px;min-width:0;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsh-powerup-prompt-group-toggle:hover{color:var(--dsw-alias-brand-primary)}
.dsh-powerup-prompt-group-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-powerup-prompt-group-actions{display:flex;align-items:center;gap:2px;flex:none}
.dsh-powerup-prompt-group-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dsh-powerup-prompt-group.is-collapsed .dsh-powerup-prompt-group-chevron{transform:rotate(-90deg)}
.dsh-powerup-prompt-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:1.4}
.dsh-powerup-prompt-group-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums}
.dsh-powerup-prompt-group-body{display:flex;flex-direction:column;gap:7px;padding:0 8px 8px}
.dsh-powerup-group-form{display:flex;align-items:center;gap:6px;padding:6px 12px 9px;flex-wrap:wrap}
.dsh-powerup-group-form .dsh-powerup-prompt-input{flex:1 1 120px;min-width:0}
.dsh-powerup-group-form .dsh-powerup-prompt-new{flex:none;white-space:nowrap;padding:0 10px}
.dsh-powerup-prompt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;transition:border-color .12s ease}
.dsh-powerup-prompt-card.drop-target{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-card[draggable=true]{cursor:grab}
.dsh-powerup-prompt-drag-handle{flex:none;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1;cursor:grab}
.dsh-powerup-prompt-card-head{display:flex;align-items:center;gap:8px;padding:8px 11px;flex-wrap:wrap}
.dsh-powerup-prompt-name{font-size:13px;font-weight:600;line-height:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-prompt-card-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex-wrap:wrap}
.dsh-powerup-linkbtn{background:none;border:0;padding:2px 4px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.7;cursor:pointer;border-radius:5px}
.dsh-powerup-linkbtn:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-linkbtn.danger:hover{color:var(--dsw-alias-state-error-primary,#d33)}
.dsh-powerup-prompt-form{display:flex;flex-direction:column;gap:10px;padding:11px 13px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-powerup-prompt-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dsh-powerup-prompt-field-label{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}
/* Custom workspace picker: a styled trigger + portaled option list. */
.dsh-powerup-ws-select{position:relative}
.dsh-powerup-ws-trigger{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:5px 9px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;text-align:left;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.dsh-powerup-ws-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-ws-trigger[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-ws-trigger:focus-visible,.dsh-powerup-ws-option:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-ws-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-ws-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dsh-powerup-ws-trigger[aria-expanded=true] .dsh-powerup-ws-chevron{transform:rotate(180deg)}
.dsh-powerup-ws-menu{position:fixed;z-index:1600;box-sizing:border-box;min-width:180px;max-width:min(360px,calc(100vw - 24px));max-height:min(320px,50vh);overflow-y:auto;padding:4px;border:0;border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-ws-option{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 9px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsh-powerup-ws-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-ws-option[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-ws-option-check{flex:none;display:inline-flex;width:14px;color:var(--dsw-alias-brand-primary)}
.dsh-powerup-ws-option-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-ws-option-hint{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10.5px}
.dsh-powerup-prompt-input{box-sizing:border-box;width:100%;min-height:32px;padding:6px 9px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;outline:none;transition:border-color .12s ease}
.dsh-powerup-prompt-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-prompt-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-powerup-prompt-textarea{min-height:110px;resize:vertical;font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11.5px;line-height:1.6}
.dsh-powerup-prompt-form-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsh-powerup-prompt-form-actions .dsh-powerup-prompt-new{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dsh-powerup-prompt-form-actions .dsh-powerup-prompt-new:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground)}
.dsh-powerup-prompt-empty{padding:18px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;text-align:center}
/* In-conversation create-prompt dialog. */
/* Mask fades in place; the dialog itself rises. Never reuse the toast
   keyframes here: they carry translate(-50%) for centered toasts and would
   drag the whole full-screen mask sideways. */
@keyframes dsh-powerup-prompt-mask-in{from{opacity:0}to{opacity:1}}
@keyframes dsh-powerup-prompt-rise{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}
.dsh-powerup-prompt-modal-mask{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur,blur(3px));pointer-events:auto;animation:dsh-powerup-prompt-mask-in .16s ease-out}
.dsh-powerup-prompt-modal{box-sizing:border-box;display:flex;flex-direction:column;width:min(460px,100%);max-height:min(680px,calc(100vh - 48px));max-height:min(680px,calc(100dvh - 48px));border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden;animation:dsh-powerup-prompt-rise .18s cubic-bezier(.2,.8,.3,1)}
@keyframes dsh-powerup-prompt-mask-out{from{opacity:1}to{opacity:0}}
@keyframes dsh-powerup-prompt-sink{from{opacity:1;transform:none}to{opacity:0;transform:translateY(4px) scale(.995)}}
.dsh-powerup-prompt-modal-mask.is-closing{animation:dsh-powerup-prompt-mask-out .14s ease-in forwards}
.dsh-powerup-prompt-modal.is-closing{animation:dsh-powerup-prompt-sink .14s ease-in forwards}
.dsh-powerup-prompt-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 14px 8px 22px}
.dsh-powerup-prompt-modal-heading{font-size:16px;line-height:24px;font-weight:500}
.dsh-powerup-prompt-modal-sub{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}
.dsh-powerup-prompt-modal-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-4px -2px 0 0;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.dsh-powerup-prompt-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-prompt-modal-body{display:flex;flex-direction:column;gap:12px;min-height:0;margin-top:8px;padding:0 22px 4px;overflow-y:auto}
.dsh-powerup-prompt-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 22px 20px}
.dsh-powerup-prompt-modal-cancel{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-powerup-prompt-modal-cancel:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-prompt-modal-save{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-powerup-prompt-modal-save:disabled{opacity:.4;cursor:not-allowed}
.dsh-powerup-prompt-modal-close:focus-visible,.dsh-powerup-prompt-modal-cancel:focus-visible,.dsh-powerup-prompt-modal-save:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
@media (max-width:560px){.dsh-powerup-prompt-modal-mask{padding:12px}.dsh-powerup-prompt-modal-head{padding:16px 12px 8px 16px}.dsh-powerup-prompt-modal-body{padding:0 16px 4px}.dsh-powerup-prompt-modal-foot{padding:12px 16px 16px}}
@media (prefers-reduced-motion:reduce){.dsh-powerup-prompt-pop,.dsh-powerup-prompt-trigger-chevron,.dsh-powerup-prompt-modal-mask,.dsh-powerup-prompt-modal,.dsh-powerup-prompt-modal-mask.is-closing,.dsh-powerup-prompt-modal.is-closing{transition:none;animation:none}}
`;

      const PROGRESS_CSS = `
/* Task-progress header button + floating panel. */
.dsh-powerup-progress-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:26px;height:26px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dsh-powerup-progress-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dsh-powerup-progress-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-powerup-progress-btn.is-running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-powerup-progress-btn.is-running svg{animation:dsh-powerup-progress-spin 1.4s linear infinite}
@keyframes dsh-powerup-progress-spin{to{transform:rotate(360deg)}}
.dsh-powerup-progress-btn-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.dsh-powerup-progress-panel{position:fixed;z-index:1500;box-sizing:border-box;display:flex;flex-direction:column;width:360px;max-width:calc(100vw - 24px);max-height:min(72vh,620px);border:0;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.55;pointer-events:auto;overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);animation:dsh-powerup-progress-in .15s ease-out}
@keyframes dsh-powerup-progress-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.dsh-powerup-progress-head{display:flex;align-items:flex-start;gap:8px;padding:14px 14px 10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-progress-heading{display:flex;flex:1 1 auto;flex-direction:column;gap:2px;min-width:0}
.dsh-powerup-progress-title{font-size:14px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-progress-sub{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.4}
.dsh-powerup-progress-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin:-2px -2px 0 0;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:17px;line-height:1;cursor:pointer}
.dsh-powerup-progress-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-progress-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 16px 16px}
.dsh-powerup-progress-loading{display:flex;align-items:center;gap:9px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-powerup-progress-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.6;overflow-wrap:anywhere}
.dsh-powerup-progress-empty{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.6}
.dsh-powerup-progress-summary{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.dsh-powerup-progress-meter{display:flex;flex-direction:column;gap:5px;margin:0 0 14px}
.dsh-powerup-progress-meter-head{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-tertiary);font-size:10.5px}
.dsh-powerup-progress-meter-head strong{color:var(--dsw-alias-brand-primary);font-size:12px;font-variant-numeric:tabular-nums}
.dsh-powerup-progress-track{height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dsh-powerup-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.dsh-powerup-progress-section{margin:12px 0 6px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.dsh-powerup-progress-items{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-powerup-progress-item{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsh-powerup-progress-badge{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;border-radius:8px;font-size:9.5px;font-weight:700;letter-spacing:.02em}
.dsh-powerup-progress-badge[data-status=pending]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-progress-badge[data-status=in-progress]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-powerup-progress-badge[data-status=done]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-powerup-progress-badge[data-status=blocked]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-powerup-progress-item-copy{display:flex;flex:1 1 auto;flex-direction:column;gap:2px;min-width:0}
.dsh-powerup-progress-item-title{color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;overflow-wrap:anywhere}
.dsh-powerup-progress-item-detail{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere}
.dsh-powerup-progress-children{margin:4px 0 0 6px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-powerup-progress-blockers{margin:12px 0 0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.55}
.dsh-powerup-progress-blockers ul{margin:4px 0 0;padding-left:16px}
.dsh-powerup-progress-display{display:flex;flex-direction:column;gap:10px;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-progress-display-head{color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.dsh-powerup-progress-display-text{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap}
.dsh-powerup-progress-kv{display:flex;flex-direction:column;gap:4px}
.dsh-powerup-progress-kv-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dsh-powerup-progress-kv-row dt{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-powerup-progress-kv-row dd{margin:0;min-width:0;text-align:right;color:var(--dsw-alias-label-primary);font-size:11.5px;overflow-wrap:anywhere}
.dsh-powerup-progress-callout{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;overflow-wrap:anywhere}
.dsh-powerup-progress-callout[data-tone=info]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dsh-powerup-progress-callout[data-tone=warn]{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-error-primary)) 10%,transparent);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-error-primary))}
.dsh-powerup-progress-callout[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-powerup-progress-bar{display:flex;flex-direction:column;gap:3px;margin-bottom:6px}
.dsh-powerup-progress-bar-head{display:flex;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dsh-powerup-progress-code{margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-powerup-progress-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-progress-refresh{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1.5;cursor:pointer}
.dsh-powerup-progress-refresh:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-powerup-progress-refresh:disabled{opacity:.45;cursor:not-allowed}
.dsh-powerup-progress-time{color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-powerup-progress-mini{height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:1.5;cursor:pointer}
.dsh-powerup-progress-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-progress-history{margin-bottom:12px}
.dsh-powerup-progress-history-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.dsh-powerup-progress-history-item{padding:3px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.5;cursor:pointer}
.dsh-powerup-progress-history-item.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.dsh-powerup-progress-age{margin:0 0 10px;padding:6px 10px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-error-primary)) 10%,transparent);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-error-primary));font-size:11px;line-height:1.5}
.dsh-powerup-progress-req-pop{padding:10px 16px 0;border-bottom:.5px solid var(--dsw-alias-border-l1);max-height:160px;overflow-y:auto}
.dsh-powerup-req-picker{display:flex;flex-direction:column;gap:4px;padding:4px 0}
.dsh-powerup-req-option{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer}
.dsh-powerup-req-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-req-option input{flex:none;accent-color:var(--dsw-alias-brand-primary)}
.dsh-powerup-req-manager{display:flex;flex-direction:column;gap:16px}
.dsh-powerup-req-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-powerup-req-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsh-powerup-req-item.off{opacity:.55}
.dsh-powerup-req-copy{display:flex;flex:1 1 auto;flex-direction:column;gap:3px;min-width:0}
.dsh-powerup-req-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-powerup-req-text{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dsh-powerup-req-form{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-req-form-foot{display:flex;justify-content:flex-end;gap:8px}
.dsh-powerup-progress-resizer{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-border-l3) 50%,transparent 62%,var(--dsw-alias-border-l3) 62%,var(--dsw-alias-border-l3) 72%,transparent 72%)}
.dsh-powerup-progress-req-editor{display:flex;flex-direction:column;gap:10px;padding:8px 0}
@media (prefers-reduced-motion:reduce){.dsh-powerup-progress-panel,.dsh-powerup-progress-btn.is-running svg,.dsh-powerup-progress-fill{animation:none;transition:none}}
/* Direct-ask button + dialog */
.dsh-powerup-directask-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;line-height:1;cursor:pointer}
.dsh-powerup-directask-btn:hover,.dsh-powerup-directask-btn.on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-powerup-directask-window{position:fixed;z-index:1600;box-sizing:border-box;display:flex;flex-direction:column;min-width:360px;min-height:280px;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;overflow:hidden;animation:dsh-powerup-progress-in .15s ease-out}
.dsh-powerup-directask-titlebar{display:flex;align-items:center;gap:8px;flex:none;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);cursor:move;user-select:none}
.dsh-powerup-directask-title{font-size:13px;font-weight:600;white-space:nowrap}
.dsh-powerup-directask-subtitle{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-directask-titlebtn,.dsh-powerup-directask-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.dsh-powerup-directask-titlebtn:hover,.dsh-powerup-directask-titlebtn.on,.dsh-powerup-directask-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-directask-history{flex:none;max-height:180px;overflow-y:auto;padding:10px 14px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-powerup-directask-history-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:11.5px}
.dsh-powerup-directask-history-list{margin:0;padding:0;list-style:none}
.dsh-powerup-directask-history-list button{width:100%;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-directask-history-list button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-directask-thread{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}
.dsh-powerup-directask-welcome{margin:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
.dsh-powerup-directask-turn{display:flex;flex-direction:column;gap:6px}
.dsh-powerup-directask-msg{display:flex;flex-direction:column;gap:4px;max-width:88%}
.dsh-powerup-directask-msg.user{align-self:flex-end;align-items:flex-end}
.dsh-powerup-directask-msg.assistant{align-self:flex-start;align-items:flex-start}
.dsh-powerup-directask-msg-body{padding:8px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-powerup-directask-msg.user .dsh-powerup-directask-msg-body{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1));border-bottom-right-radius:3px}
.dsh-powerup-directask-msg.assistant .dsh-powerup-directask-msg-body{border-bottom-left-radius:3px}
.dsh-powerup-directask-ctx{display:flex;flex-wrap:wrap;gap:4px;align-self:flex-end}
.dsh-powerup-directask-ctx span{padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10px}
.dsh-powerup-directask-files{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 6px}
.dsh-powerup-directask-file{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-powerup-directask-file button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1}
.dsh-powerup-directask-composer{flex:none;padding:10px 14px 12px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-directask-inputrow{display:flex;align-items:flex-end;gap:8px;padding:6px 6px 6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-3)}
.dsh-powerup-directask-inputrow:focus-within{border-color:var(--dsw-alias-brand-primary)}
/* Native file input is hidden; only the custom '+' chip is shown. */
.dsh-powerup-directask-attach{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;border-radius:7px;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;cursor:pointer;overflow:hidden}
.dsh-powerup-directask-attach:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-powerup-directask-attach input[type=file]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.dsh-powerup-directask-input{flex:1 1 auto;min-width:0;max-height:140px;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.6;resize:none}
.dsh-powerup-directask-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-powerup-directask-send{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-1));cursor:pointer}
.dsh-powerup-directask-send:disabled{opacity:.4;cursor:not-allowed}
.dsh-powerup-directask-resizer{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-border-l3) 50%,transparent 62%,var(--dsw-alias-border-l3) 62%,var(--dsw-alias-border-l3) 72%,transparent 72%)}
`;

      /** Max display length of a session option, in Unicode code points. */
      const SESSION_SWITCH_LABEL_MAX = 40;
      /** Separator between the workspace name and the session title. */
      const SESSION_SWITCH_LABEL_SEP = ' · ';

      /**
       * Truncate a string to a maximum number of Unicode code points, appending
       * an ellipsis when anything was cut. Code-point based so an astral emoji
       * is never split into a lone surrogate.
       * @param {string} value
       * @param {number} max
       * @returns {string}
       */
      function truncateLabel(value, max) {
        const text = typeof value === 'string' ? value : '';
        const points = [...text];
        if (points.length <= max) return text;
        const keep = Math.max(0, max - 1);
        return points.slice(0, keep).join('') + '\u2026';
      }

      /**
       * Compose the option label: `<workspace> · <session title>`, truncated as
       * a whole so the workspace prefix stays visible even for long titles.
       * @param {string} workspace workspace display name (may be empty)
       * @param {string} title session title
       * @returns {string}
       */
      function sessionOptionLabel(workspace, title) {
        const ws = typeof workspace === 'string' ? workspace : '';
        const base = typeof title === 'string' ? title : '';
        if (ws === '') return truncateLabel(base, SESSION_SWITCH_LABEL_MAX);
        return truncateLabel(ws + SESSION_SWITCH_LABEL_SEP + base, SESSION_SWITCH_LABEL_MAX);
      }

      /**
       * Project the live session list into the rows shown by the switcher.
       * Only sessions the host currently reports as running are listed; the
       * host's own list order (most recent first) is preserved. Each label is
       * prefixed with its workspace name when known.
       * @param {unknown} snapshot value of `sessions.list.getSnapshot()`
       * @param {string | undefined} currentId id of the open session
       * @param {(sessionId: string, cwd?: string) => string} [workspaceOf] resolve a workspace name
       * @param {{extraIds?: Iterable<string>, statusOf?: (id:string)=>string}} [options]
       * @returns {Array<{id:string,title:string,current:boolean,status:string}>}
       */
      function runningSessionRows(snapshot, currentId, workspaceOf, options) {
        const opts = options !== null && typeof options === 'object' ? options : {};
        const state = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
        const byId = state.byId !== null && typeof state.byId === 'object' ? state.byId : {};
        const ids = Array.isArray(state.ids) ? state.ids : Object.keys(byId);
        const resolveWorkspace = typeof workspaceOf === 'function' ? workspaceOf : () => '';
        const statusOf = typeof opts.statusOf === 'function' ? opts.statusOf : () => 'running';
        const extra = opts.extraIds instanceof Set || Array.isArray(opts.extraIds) ? opts.extraIds : [];
        const rows = [];
        const seen = new Set();
        for (const id of ids) {
          if (typeof id !== 'string' || seen.has(id)) continue;
          const item = byId[id];
          if (item === null || typeof item !== 'object') continue;
          const running = item.running === true;
          const extraKeep = extra instanceof Set ? extra.has(id) : extra.indexOf(id) !== -1;
          if (!running && !extraKeep) continue;
          seen.add(id);
          const title = typeof item.displayTitle === 'string' && item.displayTitle !== ''
            ? item.displayTitle
            : typeof item.title === 'string' && item.title !== '' ? item.title : id;
          const cwd = typeof item.cwd === 'string' ? item.cwd : undefined;
          let workspace = '';
          try {
            workspace = resolveWorkspace(id, cwd);
          } catch {
            workspace = '';
          }
          const label = sessionOptionLabel(workspace, title);
          rows.push({ id, title: label, current: id === currentId, status: statusOf(id) });
        }
        return rows;
      }

      /**
       * DOM controller for the clickable session title. React owns the crumb,
       * so this controller never replaces it: it only marks the current title
       * with a data attribute (re-applied after host re-renders) and delegates
       * clicks from the document. The dropdown itself is a body-level fixed
       * node, so the header's clipping and drag row cannot contain it.
       * @param {{t?: Function, listRows?: Function, openSession?: Function}} deps
       */
      function createSessionSwitcherCore(deps) {
        const options = deps ?? {};
        const t = typeof options.t === 'function' ? options.t : (key) => key;
        const listRows = typeof options.listRows === 'function' ? options.listRows : () => [];
        const openSession = typeof options.openSession === 'function' ? options.openSession : () => false;
        const currentSessionId = typeof options.currentSessionId === 'function' ? options.currentSessionId : () => undefined;

        const MIN_WIDTH = 220;
        const PREFERRED_HEIGHT = 320;
        const GAP = 6;
        const DRAG_THRESHOLD = 6;
        /** Re-anchor retries before a missing title counts as a view switch. */
        const REANCHOR_RETRY = 3;
        const REANCHOR_DELAY = 120;
        /** How often an open popup re-reads the session list while the host mutates. */
        const ROWS_REFRESH_MS = 400;

        let observer = null;
        let marked = [];
        let popup = null;
        let press = null;
        let started = false;
        let positionQueued = false;

        function warn(message, error) {
          try {
            console.warn('[dsh-powerup] ' + message, error?.message ?? error);
          } catch {
            /* Console output must never break the switcher. */
          }
        }

        function hasDocument() {
          return typeof document !== 'undefined' && document !== null
            && typeof document.querySelectorAll === 'function'
            && document.body !== null && document.body !== undefined;
        }

        /** The current-title crumbs inside real conversation headers. */
        function findTitles() {
          if (!hasDocument()) return [];
          const out = [];
          let headers;
          try {
            headers = document.querySelectorAll('header[data-window-drag]');
          } catch {
            headers = [];
          }
          for (const header of headers) {
            let crumbs;
            try {
              crumbs = header.querySelectorAll('[class*="crumbCurrent"]');
            } catch {
              crumbs = [];
            }
            for (const crumb of crumbs) {
              if (typeof crumb.closest !== 'function' || crumb.closest('nav[class*="crumbs"]') === null) continue;
              out.push(crumb);
            }
          }
          return out;
        }

        /**
         * Re-apply the marker after React re-renders the crumb. An open popup
         * must survive unrelated re-renders: React may replace the crumb node
         * the popup was anchored to (streaming tokens, a new background job, a
         * status line), which used to look like a view switch. Instead of
         * closing, re-anchor to the live title and re-place the panel.
         */
        function sync() {
          if (!started || !hasDocument()) return;
          const found = findTitles();
          marked = found;
          const hint = t('sessionSwitch.hint');
          for (const el of found) {
            if (!el.hasAttribute('data-powerup-session-title')) el.setAttribute('data-powerup-session-title', '');
            if (el.getAttribute('title') !== hint) el.setAttribute('title', hint);
          }
          if (popup === null) return;
          // A mounted title belonging to another session means the view really
          // switched. An empty list is only a re-render in progress, so it is
          // left to the retry path below.
          const owners = found
            .map((el) => ownerSessionId(el))
            .filter((id) => typeof id === 'string' && id !== '');
          if (typeof popup.sessionId === 'string' && popup.sessionId !== ''
            && owners.length > 0 && !owners.includes(popup.sessionId)) {
            closePopup();
            return;
          }
          if (isUsableAnchor(popup.anchor)) {
            popup.retries = 0;
            refreshPopupRows();
            schedulePosition();
            return;
          }
          reanchor(found);
        }

        /** A title crumb the panel can actually be placed against. */
        function isUsableAnchor(el) {
          return el !== null && el !== undefined
            && el.isConnected === true
            && typeof el.getBoundingClientRect === 'function';
        }

        /** The conversation header that owns a title crumb. */
        function ownerHeader(el) {
          try {
            return typeof el.closest === 'function' ? el.closest('header[data-window-drag]') : null;
          } catch {
            return null;
          }
        }

        /** The session id of the conversation subtree that owns a node. */
        function ownerSessionId(el) {
          try {
            const host = typeof el.closest === 'function' ? el.closest('[data-conversation-session]') : null;
            const id = host === null ? null : host.getAttribute('data-conversation-session');
            return typeof id === 'string' && id !== '' ? id : undefined;
          } catch {
            return undefined;
          }
        }

        /**
         * Move the open popup onto a live title after its anchor was replaced.
         * A view switch removes every title, so a missing anchor only counts
         * as a switch once the retries are exhausted; until then the popup
         * stays open at its last position.
         */
        function reanchor(found) {
          if (popup === null) return;
          const target = pickAnchor(found);
          if (target !== null && target !== popup.anchor) {
            popup.anchor = target;
            popup.retries = 0;
            schedulePosition();
            return;
          }
          if (popup.retries >= REANCHOR_RETRY) {
            closePopup();
            return;
          }
          popup.retries += 1;
          scheduleRetry();
        }

        /** The title to anchor on: the same header's crumb, else the session's. */
        function pickAnchor(found) {
          if (!Array.isArray(found) || found.length === 0) return null;
          const usable = found.filter((el) => isUsableAnchor(el));
          if (usable.length === 0) return null;
          if (usable.length === 1) return usable[0];
          if (popup !== null && popup.header !== null) {
            const same = usable.filter((el) => ownerHeader(el) === popup.header);
            if (same.length > 0) return same[0];
          }
          if (popup !== null && typeof popup.sessionId === 'string' && popup.sessionId !== '') {
            for (const el of usable) {
              if (ownerSessionId(el) === popup.sessionId) return el;
            }
          }
          return usable[0];
        }

        function scheduleRetry() {
          if (!started) return;
          if (typeof window !== 'undefined' && window !== null && typeof window.setTimeout === 'function') {
            window.setTimeout(() => { if (started && popup !== null) sync(); }, REANCHOR_DELAY);
          }
        }

        function scheduleSync() {
          if (!started) return;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => { if (started) sync(); });
          } else {
            sync();
          }
        }

        /** Coalesce position updates coming from host re-renders. */
        function schedulePosition() {
          if (popup === null || positionQueued) return;
          positionQueued = true;
          const run = () => {
            positionQueued = false;
            if (popup !== null) positionPopup();
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
          else run();
        }

        /** Rows as a stable signature, so unchanged lists cost no DOM work. */
        function rowsSignature(rows) {
          return rows.map((row) => `${row.id}\u0000${row.current ? '1' : '0'}\u0000${row.status ?? 'running'}\u0000${row.title}`).join('\u0001');
        }

        /**
         * Keep the open list current while the host keeps mutating the page:
         * a session that starts or stops changes the rows, and the popup must
         * reflect that without being torn down and reopened. Reading the
         * session snapshot is cheap but not free, so it is throttled.
         */
        function refreshPopupRows() {
          if (popup === null) return;
          const now = Date.now();
          if (popup.rowsAt !== undefined && now - popup.rowsAt < ROWS_REFRESH_MS) return;
          popup.rowsAt = now;
          let rows;
          try {
            rows = listRows();
          } catch {
            return;
          }
          if (!Array.isArray(rows)) return;
          if (popup.signature === rowsSignature(rows)) return;
          renderPopup();
        }

        function onMouseDown(event) {
          if (event.button !== 0 || typeof event.target?.closest !== 'function') return;
          const anchor = event.target.closest('[data-powerup-session-title]');
          press = anchor === null ? null : { anchor, x: event.clientX, y: event.clientY };
        }

        function onOutside(event) {
          if (popup === null || event.target === null || event.target === undefined) return;
          if (typeof popup.element.contains === 'function' && popup.element.contains(event.target)) return;
          // A re-rendered title is still our anchor: let the click handler
          // decide between closing and switching, never treat it as outside.
          if (typeof event.target.closest === 'function') {
            const title = event.target.closest('[data-powerup-session-title]');
            if (title !== null) return;
          }
          if (popup.anchor !== null && typeof popup.anchor.contains === 'function' && popup.anchor.contains(event.target)) return;
          closePopup();
        }

        function onKey(event) {
          if (popup === null || event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closePopup();
        }

        /**
         * Scrolling is not a dismissal: the host scrolls its own content while
         * a response streams. Keep the panel open and follow the anchor.
         */
        function onScroll(event) {
          if (popup === null || event.target === null || event.target === undefined) return;
          if (typeof popup.element.contains === 'function' && popup.element.contains(event.target)) return;
          schedulePosition();
        }

        function onResize() {
          if (popup === null) return;
          schedulePosition();
        }

        function onClick(event) {
          if (event.button !== 0 || typeof event.target?.closest !== 'function') return;
          if (popup !== null && typeof popup.element.contains === 'function' && popup.element.contains(event.target)) return;
          const anchor = event.target.closest('[data-powerup-session-title]');
          if (anchor === null) {
            if (popup !== null) closePopup();
            return;
          }
          // A press that moved is a window drag, not a title click.
          if (press !== null && press.anchor === anchor
            && Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > DRAG_THRESHOLD) return;
          event.preventDefault();
          event.stopPropagation();
          // The title is the toggle: a second click closes, never reopens.
          if (popup !== null) {
            closePopup();
            return;
          }
          openPopup(anchor);
        }

        function positionPopup() {
          if (popup === null || typeof window === 'undefined' || window === null) return;
          const anchor = popup.anchor;
          if (anchor === null || anchor.isConnected !== true || typeof anchor.getBoundingClientRect !== 'function') {
            // Leave the panel where it is and let sync() re-anchor it; that
            // path also owns the "the view really switched" close decision.
            scheduleSync();
            return;
          }
          const rect = anchor.getBoundingClientRect();
          const element = popup.element;
          const width = Math.max(1, Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - 24));
          const below = window.innerHeight - rect.bottom - GAP - 12;
          const above = rect.top - GAP - 12;
          const openUp = below < Math.min(PREFERRED_HEIGHT, 180) && above > below;
          const maxHeight = Math.max(120, Math.min(PREFERRED_HEIGHT, openUp ? above : below));
          element.style.width = width + 'px';
          element.style.maxHeight = maxHeight + 'px';
          element.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px';
          if (openUp) {
            element.style.bottom = (window.innerHeight - rect.top + GAP) + 'px';
            element.style.top = 'auto';
          } else {
            element.style.top = (rect.bottom + GAP) + 'px';
            element.style.bottom = 'auto';
          }
        }

        function renderPopup() {
          if (popup === null) return;
          const rows = listRows();
          popup.rows = rows;
          popup.signature = rowsSignature(rows);
          const element = popup.element;
          element.textContent = '';
          const head = document.createElement('div');
          head.className = 'dsh-powerup-session-pop-head';
          head.textContent = t('sessionSwitch.title');
          element.appendChild(head);
          if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dsh-powerup-session-pop-empty';
            empty.textContent = t('sessionSwitch.empty');
            element.appendChild(empty);
            positionPopup();
            return;
          }
          const list = document.createElement('div');
          list.className = 'dsh-powerup-session-pop-list';
          for (const row of rows) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dsh-powerup-session-pop-item';
            button.setAttribute('data-session-id', row.id);
            if (row.current) button.setAttribute('data-current', '');
            const dot = document.createElement('span');
            dot.className = 'dsh-powerup-session-pop-dot';
            dot.setAttribute('data-status', row.status === 'blocked' ? 'blocked' : 'running');
            dot.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'dsh-powerup-session-pop-label';
            label.textContent = row.title;
            button.append(dot, label);
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const id = button.getAttribute('data-session-id');
              closePopup();
              if (typeof id === 'string' && id !== '') {
                try {
                  openSession(id);
                } catch (error) {
                  warn('session switch failed:', error);
                }
              }
            });
            list.appendChild(button);
          }
          element.appendChild(list);
          positionPopup();
        }

        function openPopup(anchor) {
          closePopup();
          const element = document.createElement('div');
          element.className = 'dsh-powerup-session-pop';
          element.setAttribute('role', 'dialog');
          element.setAttribute('data-powerup-session-pop', '');
          document.body.appendChild(element);
          let openedSessionId;
          try {
            openedSessionId = currentSessionId();
          } catch {
            openedSessionId = undefined;
          }
          popup = { element, anchor, rows: [], retries: 0, sessionId: openedSessionId, header: ownerHeader(anchor) };
          renderPopup();
          const reveal = () => {
            if (popup !== null && popup.element === element) element.classList.add('is-open');
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
          else reveal();
          document.addEventListener('pointerdown', onOutside, true);
          document.addEventListener('keydown', onKey, true);
          if (typeof window !== 'undefined' && window !== null) {
            window.addEventListener('resize', onResize, true);
            window.addEventListener('scroll', onScroll, true);
          }
        }

        function closePopup() {
          if (popup === null) return;
          const element = popup.element;
          popup = null;
          positionQueued = false;
          document.removeEventListener('pointerdown', onOutside, true);
          document.removeEventListener('keydown', onKey, true);
          if (typeof window !== 'undefined' && window !== null) {
            window.removeEventListener('resize', onResize, true);
            window.removeEventListener('scroll', onScroll, true);
          }
          element.classList.remove('is-open');
          element.remove();
        }

        function start() {
          if (started || !hasDocument()) return;
          started = true;
          document.addEventListener('mousedown', onMouseDown, true);
          document.addEventListener('click', onClick, true);
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => {
              // Host re-renders are not view switches: keep an open popup and
              // let sync() re-anchor it onto the live title.
              scheduleSync();
            });
            observer.observe(document.body, { childList: true, subtree: true });
          }
          sync();
        }

        function stop() {
          started = false;
          if (observer !== null) observer.disconnect();
          observer = null;
          document.removeEventListener('mousedown', onMouseDown, true);
          document.removeEventListener('click', onClick, true);
          closePopup();
          marked = [];
          press = null;
        }

        return {
          start,
          stop,
          sync,
          getMarked: () => marked,
          getPopup: () => popup,
          refresh: () => { if (popup !== null) renderPopup(); },
          _runningSessionRows: runningSessionRows,
        };
      }

      /**
       * Index workspace titles by session id and by normalized path leaf. Used
       * to prefix session options with their workspace name.
       * @param {unknown} snapshot value of `workspaces.list.getSnapshot()`
       * @param {(title: string) => string} [displayTitle] optional default-name mapping
       * @returns {{bySession: Record<string,string>, byPath: Record<string,string>}}
       */
      function buildWorkspaceIndex(snapshot, displayTitle) {
        const state = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
        const items = Array.isArray(state.items) ? state.items : [];
        const mapTitle = typeof displayTitle === 'function' ? displayTitle : (value) => value;
        const bySession = {};
        const byPath = {};
        const normalizePath = (value) => {
          const text = typeof value === 'string' ? value.replace(/[\\/]+$/u, '') : '';
          const parts = text.split(/[\\/]/u).filter(Boolean);
          const leaf = parts.length > 0 ? parts[parts.length - 1] : '';
          return leaf.toLowerCase();
        };
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue;
          const title = mapTitle(typeof item.title === 'string' ? item.title : '');
          const sessionIds = Array.isArray(item.sessionIds) ? item.sessionIds : [];
          for (const id of sessionIds) {
            if (typeof id === 'string' && id !== '') bySession[id] = title;
          }
          const leaf = normalizePath(item.path);
          if (leaf !== '') byPath[leaf] = title;
        }
        return { bySession, byPath };
      }

      /**
       * Wire the session title switcher to the live Client services. Services
       * are read lazily at click time so late-provided ones still work.
       * @param {object} ctx client plugin context
       */
      function installSessionSwitcher(ctx) {
        const currentSessionId = () => {
          try {
            if (typeof document !== 'undefined' && document !== null) {
              const el = document.querySelector('[data-conversation-session]');
              const id = el === null ? null : el.getAttribute('data-conversation-session');
              if (typeof id === 'string' && id !== '') return id;
            }
          } catch {
            /* Fall through to the session adapter. */
          }
          try {
            const uiSession = ctx.get('uiSession');
            const binding = uiSession?.adapter?.current?.getSnapshot?.();
            if (typeof binding?.sessionId === 'string' && binding.sessionId !== '') return binding.sessionId;
          } catch {
            /* No adapter in this host. */
          }
          return undefined;
        };
        // Sessions that finished while another one was open stay in the list
        // until the user actually switches to them. A switch removes the id.
        const finishedUnseen = new Set();
        const seenRunning = new Set();
        let lastOpenedId = currentSessionId();

        /** 'blocked' while a question/plan-review interaction is pending. */
        const statusOf = (id) => {
          try {
            const ui = ctx.get('uiSession');
            const statuses = ui?.sessionStatus?.getSnapshot?.();
            const state = statuses instanceof Map ? statuses.get(id) : undefined;
            const kind = state?.pendingInteraction?.kind;
            if (kind === 'question' || kind === 'plan-review') return 'blocked';
          } catch {
            /* No status service: fall back to running. */
          }
          return 'running';
        };

        const core = createSessionSwitcherCore({
          t: (key, params) => translateCurrent(key, params),
          currentSessionId,
          listRows: () => {
            try {
              const sessions = ctx.get('sessions');
              const list = sessions?.list;
              if (list === undefined || typeof list.getSnapshot !== 'function') return [];
              const snapshot = list.getSnapshot();
              const state = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
              const byId = state.byId !== null && typeof state.byId === 'object' ? state.byId : {};
              const activeId = currentSessionId();
              if (typeof activeId === 'string' && activeId !== '') {
                if (activeId !== lastOpenedId) finishedUnseen.delete(activeId);
                lastOpenedId = activeId;
              }
              // Remember sessions that transitioned from running to idle.
              for (const id of Object.keys(byId)) {
                const item = byId[id];
                if (item !== null && typeof item === 'object' && item.running === true) finishedUnseen.delete(id);
                else if (item !== null && typeof item === 'object' && item.running === false && id !== lastOpenedId) {
                  // Only track a session we have actually seen running before.
                  if (finishedUnseen.has(id) || seenRunning.has(id)) finishedUnseen.add(id);
                }
              }
              const workspaces = ctx.get('workspaces');
              let index = { bySession: {}, byPath: {} };
              if (workspaces?.list !== undefined && typeof workspaces.list.getSnapshot === 'function') {
                index = buildWorkspaceIndex(workspaces.list.getSnapshot(), (title) =>
                  title === 'default-workspace' ? translateCurrent('sessionSwitch.defaultWorkspace') : title);
              }
              const workspaceOf = (id, cwd) => {
                if (Object.prototype.hasOwnProperty.call(index.bySession, id)) return index.bySession[id];
                if (typeof cwd === 'string') {
                  const parts = cwd.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean);
                  const leaf = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : '';
                  if (leaf !== '' && Object.prototype.hasOwnProperty.call(index.byPath, leaf)) return index.byPath[leaf];
                }
                return '';
              };
              return runningSessionRows(snapshot, currentSessionId(), workspaceOf, {
                extraIds: finishedUnseen,
                statusOf,
              });
            } catch {
              return [];
            }
          },
          openSession: (id) => {
            try {
              finishedUnseen.delete(id);
              lastOpenedId = id;
              const uiWorkspace = ctx.get('uiWorkspace');
              if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return false;
              uiWorkspace.openSession(id);
              return true;
            } catch (error) {
              warnSwitch(error);
              return false;
            }
          },
        });
        // Seed "seen running" from the first snapshot so a session finishing
        // later can be retained in the list.
        try {
          const sessions = ctx.get('sessions');
          const snapshot = sessions?.list?.getSnapshot?.();
          const byId = snapshot?.byId ?? {};
          for (const id of Object.keys(byId)) {
            if (byId[id]?.running === true) seenRunning.add(id);
          }
        } catch {
          /* No session service yet. */
        }
        ctx.effect(() => {
          const sessions = ctx.get('sessions');
          const off = typeof sessions?.list?.subscribe === 'function'
            ? sessions.list.subscribe(() => {
              const byId = sessions.list.getSnapshot()?.byId ?? {};
              for (const id of Object.keys(byId)) {
                if (byId[id]?.running === true) {
                  seenRunning.add(id);
                  finishedUnseen.delete(id);
                }
              }
            })
            : undefined;
          return () => {
            if (typeof off === 'function') off();
          };
        }, 'dsh-powerup: session status watch');
        function warnSwitch(error) {
          try {
            console.warn('[dsh-powerup] session switch failed:', error?.message ?? error);
          } catch {
            /* ignore */
          }
        }
        ctx.effect(() => {
          if (getSettings().sessionSwitch) core.start();
          const off = subscribeSettings(() => {
            if (getSettings().sessionSwitch) core.start();
            else core.stop();
          });
          return () => {
            off();
            core.stop();
          };
        }, 'dsh-powerup: session title switcher');
        return core;
      }

      /** 16-grid locate glyph: a target reticle with a center dot. */
      const LOCATE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="4.6" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

      /**
       * DOM controller for the "locate current session" button in the workspace
       * section header. It expands collapsed workspace groups until the current
       * session row is present, then centers that row in its scroll container.
       * @param {{t?: Function, currentSessionId?: Function, isEnabled?: Function}} deps
       */
      function createLocateSessionCore(deps) {
        const options = deps ?? {};
        const t = typeof options.t === 'function' ? options.t : (key) => key;
        const currentSessionId = typeof options.currentSessionId === 'function' ? options.currentSessionId : () => undefined;
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;

        let button = null;
        let observer = null;
        let started = false;
        let expandAttempts = 0;

        function hasDocument() {
          return typeof document !== 'undefined' && document !== null
            && typeof document.querySelector === 'function' && document.body !== null;
        }

        function header() {
          if (!hasDocument()) return null;
          return document.querySelector('[data-sidebar-workspace-header]');
        }

        function sessionRow(id) {
          if (!hasDocument() || typeof id !== 'string' || id === '') return null;
          const rows = document.querySelectorAll('[data-row-key^="session:"]');
          for (const el of rows) {
            if (el.getAttribute('data-row-key') === 'session:' + id) return el;
          }
          return null;
        }

        function collapsedWorkspaces() {
          if (!hasDocument()) return [];
          const rows = document.querySelectorAll('[data-row-key^="workspace:"]');
          const out = [];
          for (const el of rows) {
            if (el.getAttribute('aria-expanded') === 'false') out.push(el);
          }
          return out;
        }

        function locate() {
          if (!hasDocument()) return;
          const id = currentSessionId();
          if (typeof id !== 'string' || id === '') return;
          expandAttempts = 0;
          const reveal = () => {
            const row = sessionRow(id);
            if (row === null) {
              // Expand one collapsed workspace at a time, then retry after the
              // host re-renders. Bound the loop so a missing row cannot spin.
              if (expandAttempts >= 24) return;
              const collapsed = collapsedWorkspaces();
              if (collapsed.length === 0) return;
              expandAttempts += 1;
              const target = collapsed[collapsed.length - 1];
              target.click();
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
              else setTimeout(reveal, 16);
              return;
            }
            try {
              row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            } catch {
              row.scrollIntoView();
            }
          };
          reveal();
        }

        /** The action row the button lives in, marked so CSS can widen it. */
        let actions = null;

        function clearActions() {
          if (actions !== null) {
            try {
              actions.removeAttribute('data-powerup-locate-actions');
            } catch {
              /* A detached node is already clean. */
            }
          }
          actions = null;
        }

        function ensureButton() {
          const host = header();
          if (host === null || !isEnabled()) {
            if (button !== null) {
              button.remove();
              button = null;
            }
            clearActions();
            return;
          }
          if (button !== null && button.isConnected === true) {
            // React can replace the row without dropping our button; re-mark it.
            const parent = button.parentElement;
            if (parent !== null && parent !== undefined
              && typeof parent.setAttribute === 'function'
              && typeof parent.hasAttribute === 'function'
              && !parent.hasAttribute('data-powerup-locate-actions')) {
              parent.setAttribute('data-powerup-locate-actions', '');
              actions = parent;
            }
            return;
          }
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'dsh-powerup-locate';
          button.setAttribute('data-powerup-locate', '');
          button.setAttribute('aria-label', t('locate.label'));
          button.setAttribute('title', t('locate.hint'));
          button.innerHTML = LOCATE_ICON;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            locate();
          });
          const row = host.querySelector('[class*="headerActions"]') ?? host;
          // The host clips this row at 60px; the marker lets LOCATE_CSS widen it
          // so the third button is actually reachable.
          if (typeof row.setAttribute === 'function') {
            row.setAttribute('data-powerup-locate-actions', '');
            actions = row;
          }
          row.appendChild(button);
        }

        function sync() {
          if (!started) return;
          ensureButton();
        }

        function start() {
          if (started || !hasDocument()) return;
          started = true;
          ensureButton();
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => sync());
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }

        function stop() {
          started = false;
          if (observer !== null) observer.disconnect();
          observer = null;
          if (button !== null) button.remove();
          button = null;
          clearActions();
        }

        return { start, stop, sync, locate, sessionRow, collapsedWorkspaces };
      }

      /**
       * Install the workspace "locate current session" button.
       * @param {object} ctx client plugin context
       */
      function installLocateSession(ctx) {
        const currentSessionId = () => {
          try {
            const el = document.querySelector('[data-conversation-session]');
            const id = el === null ? null : el.getAttribute('data-conversation-session');
            return typeof id === 'string' && id !== '' ? id : undefined;
          } catch {
            return undefined;
          }
        };
        const core = createLocateSessionCore({
          t: (key, params) => translateCurrent(key, params),
          currentSessionId,
          isEnabled: () => getSettings().locateSession,
        });
        ctx.effect(() => {
          if (getSettings().locateSession) core.start();
          const off = subscribeSettings(() => {
            if (getSettings().locateSession) core.start();
            else core.stop();
          });
          return () => {
            off();
            core.stop();
          };
        }, 'dsh-powerup: locate session');
        return core;
      }

      /**
       * Back-to-top button for the left sidebar. It is injected into the host's
       * New Session row (`[class*="newSessionRow"]`) and only becomes visible
       * once the workspace list has been scrolled away from the top. Clicking
       * it scrolls both the outer sidebar viewport and the workspace list back
       * to the very top. No host modules are imported — we observe the same
       * `data-*` contracts the other sidebar features already use.
       * @param {{t?: Function, isEnabled?: Function, threshold?: number}} deps
       */
      function createScrollToTopCore(deps) {
        const options = deps ?? {};
        const t = typeof options.t === 'function' ? options.t : (key) => key;
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
        const threshold = Number.isFinite(options.threshold) ? options.threshold : 24;

        let button = null;
        let observer = null;
        let started = false;
        let boundContainers = [];
        let detachListeners = [];

        function hasDocument() {
          return typeof document !== 'undefined' && document !== null
            && typeof document.querySelector === 'function' && document.body !== null;
        }

        /** Both scrollers can carry the offset; the outer viewport wins. */
        function scrollContainers() {
          if (!hasDocument()) return [];
          const out = [];
          const outer = document.querySelector('[data-sidebar-scrollport]');
          if (outer !== null) out.push(outer);
          const inner = document.querySelector('[data-sidebar-list-area]');
          if (inner !== null && !out.includes(inner)) out.push(inner);
          return out;
        }

        function scrolledDown() {
          return scrollContainers().some((el) => (el.scrollTop || 0) > threshold);
        }

        function syncVisibility() {
          if (button === null) return;
          button.setAttribute('data-visible', scrolledDown() ? 'true' : 'false');
        }

        function toTop() {
          for (const el of scrollContainers()) {
            try {
              el.scrollTo({ top: 0, behavior: 'smooth' });
            } catch {
              el.scrollTop = 0;
            }
          }
          syncVisibility();
        }

        function row() {
          if (!hasDocument()) return null;
          return document.querySelector('[class*="newSessionRow"]');
        }

        function bindScrollers() {
          for (const off of detachListeners) {
            try { off(); } catch { /* already detached */ }
          }
          detachListeners = [];
          boundContainers = scrollContainers();
          for (const el of boundContainers) {
            const handler = () => syncVisibility();
            el.addEventListener('scroll', handler, { passive: true });
            detachListeners.push(() => el.removeEventListener('scroll', handler));
          }
          syncVisibility();
        }

        function ensureButton() {
          const host = row();
          if (host === null || !isEnabled()) {
            if (button !== null) {
              button.remove();
              button = null;
            }
            return;
          }
          if (button !== null && button.isConnected === true) return;
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'dsh-powerup-scrolltop';
          button.setAttribute('data-powerup-scrolltop', '');
          button.setAttribute('data-visible', 'false');
          button.setAttribute('aria-label', t('scrollToTop.label'));
          button.setAttribute('title', t('scrollToTop.hint'));
          button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M8 12.5V3.5M4.2 7.3 8 3.5l3.8 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toTop();
          });
          host.appendChild(button);
          bindScrollers();
        }

        function sync() {
          if (!started) return;
          const containers = scrollContainers();
          if (containers.length !== boundContainers.length || containers.some((el, i) => el !== boundContainers[i])) {
            bindScrollers();
          }
          ensureButton();
          syncVisibility();
        }

        function start() {
          if (started || !hasDocument()) return;
          started = true;
          ensureButton();
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => sync());
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }

        function stop() {
          started = false;
          if (observer !== null) observer.disconnect();
          observer = null;
          for (const off of detachListeners) {
            try { off(); } catch { /* already detached */ }
          }
          detachListeners = [];
          boundContainers = [];
          if (button !== null) button.remove();
          button = null;
        }

        return { start, stop, sync, toTop, scrollContainers, scrolledDown };
      }

      /**
       * Install the sidebar back-to-top button.
       * @param {object} ctx client plugin context
       */
      function installScrollToTop(ctx) {
        const core = createScrollToTopCore({
          t: (key, params) => translateCurrent(key, params),
          isEnabled: () => getSettings().scrollToTop,
        });
        ctx.effect(() => {
          if (getSettings().scrollToTop) core.start();
          const off = subscribeSettings(() => {
            if (getSettings().scrollToTop) core.start();
            else core.stop();
          });
          return () => {
            off();
            core.stop();
          };
        }, 'dsh-powerup: sidebar scroll to top');
        return core;
      }

      /**
       * DOM-based masking for assistant reply prose. We observe the Chat view's
       * assistant reply rows and replace matching text fragments in place. The
       * original text of each text node is cached in a WeakMap so a re-render
       * that restores it can be masked again, and a re-render that produces a
       * new node is picked up by the MutationObserver. Only reply rows
       * (`data-chat-flow-kind="assistant-step"` with `group-part="response"`)
       * are touched; reasoning disclosures and tool calls are left alone.
       * @param {{isEnabled?: Function, rules?: Function}} deps
       */
      function createReplyMaskCore(deps) {
        const options = deps ?? {};
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
        const rulesOf = typeof options.rules === 'function' ? options.rules : () => [];
        const originals = new WeakMap();
        let observer = null;
        let timer = null;
        let started = false;
        let compiled = [];
        let sweeping = false;

        function hasDocument() {
          return typeof document !== 'undefined' && document !== null
            && typeof document.querySelectorAll === 'function' && document.body !== null;
        }

        function refreshRules() {
          compiled = compileMaskRules(rulesOf());
        }

        function maskTextNode(node) {
          if (node.nodeType !== 3) return; // Node.TEXT_NODE
          const current = node.nodeValue ?? '';
          const original = originals.get(node);
          if (original !== undefined) {
            const maskedFromOriginal = applyMaskRules(original, compiled);
            if (current === maskedFromOriginal) return; // still our masked output
          }
          // Either a fresh node, React restored the original, or streaming grew
          // the text. Treat what is on screen now as the source of truth.
          originals.set(node, current);
          const masked = applyMaskRules(current, compiled);
          if (masked !== current) node.nodeValue = masked;
        }

        function maskRow(row) {
          // Only the assistant's answer prose; skip reasoning / tool rows.
          const kind = row.getAttribute('data-chat-flow-kind');
          const part = row.getAttribute('data-chat-group-part');
          if (kind !== 'assistant-step' || (part !== null && part !== 'response')) return;
          const body = row.querySelector('[data-streaming], .dsh-powerup-mask-root') ?? row;
          const walker = document.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */, null);
          let node;
          while ((node = walker.nextNode()) !== null) {
            maskTextNode(node);
          }
        }

        function sweep() {
          if (!started || !isEnabled() || compiled.length === 0 || sweeping) return;
          // Changing nodeValue fires our own characterData observer; the flag
          // keeps that from cascading into another full sweep.
          sweeping = true;
          try {
            const rows = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]');
            for (const row of rows) maskRow(row);
          } finally {
            setTimeout(() => { sweeping = false; }, 0);
          }
        }

        function schedule() {
          if (timer !== null) return;
          timer = setTimeout(() => {
            timer = null;
            sweep();
          }, 40);
        }

        function start() {
          if (started || !hasDocument()) return;
          started = true;
          refreshRules();
          sweep();
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => schedule());
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          }
        }

        function stop() {
          started = false;
          if (observer !== null) observer.disconnect();
          observer = null;
          if (timer !== null) clearTimeout(timer);
          timer = null;
        }

        return { start, stop, sweep, refreshRules, maskRow, applyMaskRules, compileMaskRules };
      }

      /** Install the reply-mask observer and keep its compiled rules in sync. */
      function installReplyMask(ctx) {
        const core = createReplyMaskCore({
          isEnabled: () => getSettings().contentRendering,
          rules: () => activeMaskRules(),
        });
        const enabled = () => getSettings().contentRendering;
        ctx.effect(() => {
          if (enabled()) core.start();
          const offSettings = subscribeSettings(() => {
            if (enabled()) { core.refreshRules(); core.start(); core.sweep(); }
            else core.stop();
          });
          const offRules = subscribeMaskRules(() => {
            core.refreshRules();
            if (enabled()) core.sweep();
          });
          return () => {
            offSettings();
            offRules();
            core.stop();
          };
        }, 'dsh-powerup: reply mask');
        return core;
      }

      function installStyles(ctx) {
        try {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-powerup', '');
          style.textContent = CSS + '\n' + LAUNCHER_CSS + '\n' + SESSION_SWITCH_CSS + '\n' + LOCATE_CSS + '\n' + SCROLL_TOP_CSS + '\n' + RENDERING_CSS + '\n' + PROMPTS_CSS + '\n' + PROGRESS_CSS;
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
          if (!settings.contextMenu) {
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
        }, [settings.contextMenu, close, t, ctx, notify]);

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
      /** Host route that closes the whole application. */
      const CLOSE_API = '/dsh-powerup/api/close';
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
      function popoverPlacement(anchor, minWidth, preferredHeight, options) {
        const rect = anchor.getBoundingClientRect();
        const gap = 6;
        const margin = 12;
        const opts = options ?? {};
        const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
        const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
        const width = Math.min(Math.max(rect.width, minWidth), Math.max(200, viewportWidth - margin * 2));
        const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
        const spaceBelow = viewportHeight - rect.bottom - margin - gap;
        const spaceAbove = rect.top - margin - gap;
        // 'up' forces upward expansion (composer at the screen bottom); 'auto'
        // keeps the original flip-when-cramped behavior used by the hero.
        const above = opts.preferUp === true
          ? spaceAbove >= Math.min(preferredHeight, 180)
          : spaceBelow < Math.min(preferredHeight, 180) && spaceAbove > spaceBelow;
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
        const settings = useSettings();
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
          if (!settings.jobStop) {
            setTarget(null);
            return undefined;
          }
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
        }, [jobs, settings.jobStop]);

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
        const settings = useSettings();
        const [view, setView] = useState(null);
        const [localeTick, forceLocale] = useState(0);
        const [pending, setPending] = useState(() => readPendingRestarts());
        /** Open app-level confirmation: null, 'restart' or 'close'. */
        const [appAsk, setAppAsk] = useState(null);
        const [appCapability, setAppCapability] = useState(null);
        const [appBusy, setAppBusy] = useState(false);
        const [appError, setAppError] = useState(null);
        /** Running tasks reported by the Host for the app action dialog. */
        const [appTasks, setAppTasks] = useState([]);
        /** Checkbox: force-stopped tasks are resumed on next launch. */
        const [appResume, setAppResume] = useState(true);
        /** Optional custom continuation prompt. */
        const [appResumePrompt, setAppResumePrompt] = useState('');
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
          if (!settings.update) return undefined;
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
        }, [localeTick, pending, settings.update]);

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

        // Escape dismisses the app-level confirmation unless its request is
        // already in flight.
        useEffect(() => {
          if (appAsk === null) return undefined;
          const onKeyDown = (event) => {
            if (event.key !== 'Escape' || appBusy) return;
            event.stopPropagation();
            setAppAsk(null);
          };
          document.addEventListener('keydown', onKeyDown, true);
          return () => document.removeEventListener('keydown', onKeyDown, true);
        }, [appAsk, appBusy]);

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

        /** Ask one Host app-control route whether this runtime supports it. */
        const readAppCapability = async (api) => {
          try {
            const response = await fetch(api, { headers: { accept: 'application/json' } });
            const data = await response.json();
            return {
              supported: response.ok && data?.ok === true && data.supported === true,
              reason: typeof data?.reason === 'string' ? data.reason : '',
            };
          } catch (error) {
            return { supported: false, reason: errorText(error) };
          }
        };

        /** The restart capability, used by the install flow as well. */
        const readRestartCapability = () => readAppCapability(UPDATE_API);

        /** POST one app-control command; throws when the Host refuses. */
        const requestAppAction = async (action, options = {}) => {
          const api = action === 'close' ? CLOSE_API : UPDATE_API;
          // Sending a body opts into the task-aware path. The plugin self-update
          // flow calls requestAppRestart() with no options and keeps its old
          // behaviour (no task gate) by not sending a body.
          const aware = options.aware === true;
          const body = aware ? JSON.stringify({
            action,
            force: options.force === true,
            resume: options.resume === true,
            resumePrompt: typeof options.resumePrompt === 'string' ? options.resumePrompt : '',
          }) : undefined;
          const response = await fetch(api, {
            method: 'POST',
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.ok !== true) {
            if (data?.code === 'tasks-running' && Array.isArray(data.runningTasks)) {
              setAppTasks(data.runningTasks);
            }
            throw new Error(data?.error ?? `HTTP ${response.status}`);
          }
          return data;
        };

        /** The restart command, as the install flow spells it. */
        const requestAppRestart = () => requestAppAction('restart');

        /** Open the app-level confirmation for one action and read its capability. */
        const openAppAction = (action) => {
          setAppAsk(action);
          setAppCapability(null);
          setAppError(null);
          setAppBusy(false);
          setAppTasks([]);
          setAppResume(true);
          setAppResumePrompt('');
          const api = action === 'close' ? CLOSE_API : UPDATE_API;
          void fetch(api, { headers: { accept: 'application/json' } })
            .then((response) => response.json())
            .then((data) => {
              setAppCapability({
                supported: data?.ok === true && data.supported === true,
                reason: typeof data?.reason === 'string' ? data.reason : '',
              });
              if (Array.isArray(data?.runningTasks)) setAppTasks(data.runningTasks);
            })
            .catch((error) => setAppCapability({ supported: false, reason: errorText(error) }));
        };
        const openAppActionRef = useRef(() => {});
        openAppActionRef.current = openAppAction;
        openRestartRef.current = () => openAppActionRef.current('restart');

        // The sidebar launcher is plain DOM and cannot render React, so it
        // calls these openers for its synthetic restart/close tiles. Keeping
        // them here means the sidebar and the pending-restart bar share one
        // confirmation dialog, one capability read and one set of copy.
        useEffect(() => {
          restartPromptBridge.open = () => openAppActionRef.current('restart');
          closePromptBridge.open = () => openAppActionRef.current('close');
          return () => {
            if (restartPromptBridge.open !== null) restartPromptBridge.open = null;
            if (closePromptBridge.open !== null) closePromptBridge.open = null;
          };
        }, []);

        /** Confirm the app-level action (restart or close). */
        const confirmAppAction = async (forced = false) => {
          if (appBusy) return;
          if (!forced && appTasks.length > 0) return;
          setAppBusy(true);
          setAppError(null);
          try {
            const data = await requestAppAction(appAsk === 'close' ? 'close' : 'restart', {
              aware: true,
              force: forced,
              resume: forced && appResume,
              resumePrompt: appResumePrompt,
            });
            // The app is about to exit; nothing more to render.
            void data;
          } catch (error) {
            setAppBusy(false);
            setAppError(errorText(error) || tRef.current('update.unknown'));
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

        const appAction = appAsk === 'close' ? 'close' : 'restart';
        const appPrompt = appAsk === null ? null : h('div', {
          className: 'dsh-powerup-update-mask',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !appBusy) setAppAsk(null);
          },
        },
        h('div', {
          className: 'dsh-powerup-update-dialog',
          style: { width: 'min(420px,100%)' },
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-powerup-app-action-title',
        },
        h('div', { className: 'dsh-powerup-update-head' },
          h('div', { className: 'dsh-powerup-update-heading' },
            h('h2', { id: 'dsh-powerup-app-action-title' }, t(appAction === 'close' ? 'close.title' : 'restart.title')),
            /* A sidebar-initiated restart usually has no pending plugins, so the
               subtitle only appears when there is something to report. */
            appAction === 'restart' && pending.length > 0 ? h('p', null, t('restart.pending', { count: pending.length })) : null,
          ),
          appBusy ? null : h('button', { type: 'button', className: 'dsh-powerup-update-close', 'aria-label': t('update.close'), onClick: () => setAppAsk(null) }, '×'),
        ),
        h('div', { className: 'dsh-powerup-update-body' },
          h('p', { className: 'dsh-powerup-update-note' }, t(appAction === 'close' ? 'close.desc' : 'restart.desc')),
          appTasks.length > 0
            ? h('div', { className: 'dsh-powerup-update-tasks' },
              h('strong', null, t('restart.tasksTitle', { count: appTasks.length })),
              h('p', { className: 'dsh-powerup-update-note' }, t('restart.tasksHint')),
              h('ul', { className: 'dsh-powerup-update-task-list' },
                appTasks.slice(0, 8).map((task, index) => h('li', { key: `${task.kind}-${task.id}-${index}` },
                  h('span', { className: 'dsh-powerup-update-task-dot' }),
                  h('span', { className: 'dsh-powerup-update-task-title' },
                    task.title && task.title !== 'session' ? task.title : t('restart.taskFallback'),
                  ),
                  h('code', { title: task.id }, task.id),
                )),
              ),
              h('label', { className: 'dsh-powerup-app-check' },
                h('input', {
                  type: 'checkbox',
                  checked: appResume,
                  onChange: (event) => setAppResume(event.target.checked === true),
                  disabled: appBusy,
                }),
                h('span', null,
                  h('strong', null, t(appAction === 'close' ? 'restart.resumeLabelClose' : 'restart.resumeLabel')),
                  h('small', null, t('restart.resumeHint')),
                ),
              ),
              appResume
                ? h('input', {
                  className: 'dsh-powerup-prompt-input',
                  type: 'text',
                  value: appResumePrompt,
                  placeholder: t('restart.resumePromptPlaceholder'),
                  disabled: appBusy,
                  onChange: (event) => setAppResumePrompt(event.target.value),
                })
                : null,
            )
            : null,
          appCapability !== null && appCapability.supported !== true
            ? notice('warn', h(WarnIcon, { size: 14 }), null, t(appAction === 'close' ? 'close.unsupported' : 'update.restartUnsupported', { reason: appCapability.reason ?? '' }))
            : null,
          appError === null ? null : notice('error', h(WarnIcon, { size: 14 }), null, appError),
          appBusy
            ? h('div', { className: 'dsh-powerup-update-status' },
              h('span', { className: 'dsh-powerup-update-spinner', 'aria-hidden': 'true' }),
              t(appAction === 'close' ? 'close.closing' : 'update.restarting'),
            )
            : null,
        ),
        h('div', { className: 'dsh-powerup-update-foot' },
          h('button', { type: 'button', className: 'dsh-powerup-update-ghost', disabled: appBusy, onClick: () => setAppAsk(null) }, t(appAction === 'close' ? 'close.cancel' : 'restart.cancel')),
          appTasks.length > 0
            ? h('button', {
              type: 'button',
              className: 'dsh-powerup-update-primary',
              disabled: appBusy || appCapability?.supported !== true,
              onClick: () => void confirmAppAction(true),
            }, appBusy ? t(appAction === 'close' ? 'close.closing' : 'update.restarting') : t(appAction === 'close' ? 'restart.forceCloseLabel' : 'restart.forceLabel'))
            : h('button', {
              type: 'button',
              className: 'dsh-powerup-update-primary',
              disabled: appBusy || appCapability?.supported !== true,
              onClick: () => void confirmAppAction(false),
            }, appBusy ? t(appAction === 'close' ? 'close.closing' : 'update.restarting') : t(appAction === 'close' ? 'close.confirm' : 'restart.confirm')),
        ),
        ),
        );

        if (view === null) return appPrompt;
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
      // Prompt management tab (dsh-memory-style cards)
      // ------------------------------------------------------------------
      /**
       * Custom workspace picker: a host-styled trigger with a portaled option
       * list, so the settings page does not use the browser's native select.
       */
      function WorkspaceSelect({ value, options, onChange, t }) {
        const [open, setOpen] = useState(false);
        const anchorRef = useRef(null);
        const menuRef = useRef(null);
        const [, forceTick] = useState(0);
        const current = options.find((option) => option.value === value) ?? options[0];
        const label = current?.label ?? t('prompts.anyWorkspace');

        const place = () => {
          const menu = menuRef.current;
          const anchor = anchorRef.current;
          if (menu === null || menu === undefined || anchor === null || anchor === undefined) return;
          try {
            const pos = popoverPlacement(anchor, Math.max(anchor.getBoundingClientRect().width, 180), 320);
            menu.style.width = pos.width + 'px';
            menu.style.maxHeight = pos.maxHeight + 'px';
            menu.style.left = pos.left + 'px';
            if (typeof pos.bottom === 'number') {
              menu.style.bottom = pos.bottom + 'px';
              menu.style.top = 'auto';
            } else {
              menu.style.top = typeof pos.top === 'number' ? pos.top + 'px' : '0px';
              menu.style.bottom = 'auto';
            }
          } catch {
            /* The menu still renders at its default position. */
          }
        };
        useEffect(() => {
          if (!open) return undefined;
          place();
          const onOutside = (event) => {
            if (menuRef.current?.contains?.(event.target)) return;
            if (anchorRef.current?.contains?.(event.target)) return;
            setOpen(false);
          };
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          const onScroll = () => place();
          document.addEventListener('pointerdown', onOutside, true);
          document.addEventListener('keydown', onKey, true);
          window.addEventListener?.('resize', onScroll, true);
          window.addEventListener?.('scroll', onScroll, true);
          return () => {
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener?.('resize', onScroll, true);
            window.removeEventListener?.('scroll', onScroll, true);
          };
        }, [open]);
        useEffect(() => () => forceTick(0), []);

        return h('div', { className: 'dsh-powerup-ws-select' },
          h('button', {
            type: 'button',
            ref: anchorRef,
            className: 'dsh-powerup-ws-trigger',
            'aria-haspopup': 'listbox',
            'aria-expanded': open ? 'true' : 'false',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen((v) => !v);
            },
          },
            h('span', { className: 'dsh-powerup-ws-value' }, label),
            h('span', { className: 'dsh-powerup-ws-chevron', 'aria-hidden': 'true' },
              h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none' },
                h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              ),
            ),
          ),
          open
            ? renderInBody(h('div', {
              ref: menuRef,
              className: 'dsh-powerup-ws-menu',
              role: 'listbox',
            }, options.map((option) => h('button', {
              type: 'button',
              key: option.value,
              className: 'dsh-powerup-ws-option',
              role: 'option',
              'aria-selected': option.value === value ? 'true' : 'false',
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(option.value);
                setOpen(false);
              },
            },
              h('span', { className: 'dsh-powerup-ws-option-check', 'aria-hidden': 'true' },
                option.value === value ? h(CheckIcon, { size: 12 }) : null),
              h('span', { className: 'dsh-powerup-ws-option-label' }, option.label),
              option.hint ? h('span', { className: 'dsh-powerup-ws-option-hint' }, option.hint) : null,
            ))))
            : null,
        );
      }

      /**
       * Shared editor for a list of mask rules. `scope` is 'global' or
       * 'workspace'; writes go through the matching store functions.
       */
      function MaskRuleEditor({ scope, t, workspaceId }) {
        const rules = useMaskRules();
        const ws = typeof workspaceId === 'string' ? workspaceId : maskRulesWorkspace;
        const visible = rules.filter((rule) => {
          const ruleScope = rule.scope || 'global';
          if (ruleScope !== scope) return false;
          return scope === 'workspace' ? (rule.workspaceId ?? '') === ws : true;
        });
        const commit = (next) => {
          if (scope === 'workspace') writeWorkspaceMaskRules(next, ws);
          else writeGlobalMaskRules(next);
        };
        const update = (id, patch) => {
          commit(visible.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
        };
        const remove = (id) => {
          commit(visible.filter((rule) => rule.id !== id));
        };
        const add = () => {
          commit([...visible, { id: newId(), pattern: '', replacement: '', enabled: true, scope, workspaceId: scope === 'workspace' ? ws : '' }]);
        };
        const title = scope === 'workspace' ? t('mask.workspaceTitle') : t('mask.globalTitle');
        return h('div', { className: 'dsh-powerup-mask-editor' },
          h('h3', { className: 'dsh-powerup-section-title' }, title),
          h('p', { className: 'dsh-powerup-card-desc' }, t('mask.hint')),
          ...visible.map((rule) => {
            let invalid = false;
            if (rule.pattern !== '' && rule.regex !== false) {
              try { new RegExp(rule.pattern, 'gums'); } catch { invalid = true; }
            }
            return h('div', { key: rule.id, className: 'dsh-powerup-mask-row' },
              h('div', { className: 'dsh-powerup-mask-replacement' },
                h('input', {
                  type: 'text',
                  className: 'dsh-powerup-mask-input' + (invalid ? ' invalid' : ''),
                  value: rule.pattern,
                  placeholder: t('mask.patternPlaceholder'),
                  'aria-label': t('mask.pattern'),
                  title: invalid ? t('mask.invalid') : t('mask.pattern'),
                  onChange: (event) => update(rule.id, { pattern: event.target.value }),
                }),
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': rule.regex !== false ? 'true' : 'false',
                  className: 'dsh-powerup-mask-default' + (rule.regex !== false ? ' on' : ''),
                  title: t('mask.regexHint'),
                  'aria-label': t('mask.regexHint'),
                  onClick: () => update(rule.id, { regex: rule.regex === false }),
                }, t('mask.regex')),
              ),
              h('div', { className: 'dsh-powerup-mask-replacement' },
                h('input', {
                  type: 'text',
                  className: 'dsh-powerup-mask-input',
                  value: rule.replacement,
                  placeholder: t('mask.replacementPlaceholder'),
                  'aria-label': t('mask.replacement'),
                  onChange: (event) => update(rule.id, { replacement: event.target.value }),
                }),
                h('button', {
                  type: 'button',
                  className: 'dsh-powerup-mask-default',
                  title: t('mask.useDefaultHint'),
                  'aria-label': t('mask.useDefaultHint'),
                  onClick: () => update(rule.id, { replacement: MASK_PLACEHOLDER }),
                }, t('mask.useDefault')),
              ),
              h('button', {
                type: 'button',
                role: 'switch',
                'aria-checked': rule.enabled ? 'true' : 'false',
                className: 'dsh-powerup-switch',
                onClick: () => update(rule.id, { enabled: !rule.enabled }),
              }, invalid ? t('mask.invalid') : (rule.enabled ? t('page.enabled') : t('page.disabled'))),
              h('button', {
                type: 'button',
                className: 'dsh-powerup-prompt-new',
                onClick: () => remove(rule.id),
              }, t('mask.delete')),
            );
          }),
          visible.length === 0 ? h('p', { className: 'dsh-powerup-mask-empty' }, t('mask.empty')) : null,
          h('button', {
            type: 'button',
            className: 'dsh-powerup-prompt-new',
            onClick: add,
          }, t('mask.add')),
        );
      }

      function useMaskRules() {
        const [revision, setRevision] = useState(0);
        useEffect(() => subscribeMaskRules(() => setRevision((v) => v + 1)), []);
        useEffect(() => { void loadWorkspaceMaskRules(); }, []);
        void revision;
        return [...globalMaskRules, ...allWorkspaceMaskRules];
      }

      /**
       * Two send buttons injected into the composer's right slot. Enter / the
       * host primary button keep their own behavior; we add explicit queued and
       * interrupt controls that bypass the system busy-time setting.
       */
      /**
       * Whether the given session is currently working. Reads the host's
       * sessions list snapshot (`byId[id].running`) and re-renders when that
       * store changes. Falls back to false when the host exposes no list, so an
       * unknown state keeps the native single button.
       */
      function useSessionRunning(ctx, sessionId) {
        const read = useCallback(() => {
          if (typeof sessionId !== 'string' || sessionId === '') return false;
          try {
            const list = ctx.get('sessions')?.list;
            if (list === undefined || typeof list.getSnapshot !== 'function') return false;
            const snapshot = list.getSnapshot();
            const byId = snapshot !== null && typeof snapshot === 'object' ? snapshot.byId : undefined;
            const item = byId !== null && typeof byId === 'object' ? byId[sessionId] : undefined;
            return item !== null && typeof item === 'object' && item.running === true;
          } catch {
            return false;
          }
        }, [ctx, sessionId]);
        const [running, setRunning] = useState(read);
        useEffect(() => {
          setRunning(read());
          const list = ctx.get('sessions')?.list;
          if (list === undefined || typeof list.subscribe !== 'function') return undefined;
          return list.subscribe(() => setRunning(read()));
        }, [read, ctx]);
        return running;
      }

      /**
       * The host's live "busy Enter" preference: 'queue' or 'steer'. The host
       * composer resolves plain Enter (and its single Send button) with this
       * value, so knowing it tells us which delivery mode the native button
       * already covers. Reads the Host config form for the ui-conversation
       * namespace and subscribes, so a Settings change applies immediately.
       */
      function useHostBusyEnter(ctx) {
        const formOf = useCallback(() => {
          try {
            return ctx.get('configForms')?.get?.('ui-conversation');
          } catch {
            return undefined;
          }
        }, [ctx]);
        const read = useCallback(() => {
          try {
            const value = formOf()?.getSnapshot?.()?.value;
            const behavior = value !== null && typeof value === 'object' ? value.busyEnter : undefined;
            return behavior === 'steer' ? 'steer' : 'queue';
          } catch {
            return 'queue';
          }
        }, [formOf]);
        const [behavior, setBehavior] = useState(read);
        useEffect(() => {
          setBehavior(read());
          let off;
          let timer;
          // The settings service may be provided after this plugin applies;
          // keep looking briefly instead of latching onto a missing service.
          const attach = (attempt) => {
            const form = formOf();
            if (form !== undefined && typeof form.subscribe === 'function') {
              off = form.subscribe(() => setBehavior(read()));
              return;
            }
            if (attempt >= 20) return;
            timer = setTimeout(() => attach(attempt + 1), 500);
          };
          attach(0);
          return () => {
            if (timer !== undefined) clearTimeout(timer);
            if (typeof off === 'function') off();
          };
        }, [read, formOf]);
        return behavior;
      }

      /**
       * Lightning-bolt button in the composer (icon only). Opens a floating,
       * draggable + resizable DSH-styled Q&A window that talks straight to the
       * model — no Agent, system prompt, tools or skills. Supports continuous
       * multi-turn Q&A and a browsable/clearable history of past exchanges.
       */
      function DirectAskButton({ sessionId }) {
        const settings = useSettings();
        const [open, setOpen] = useState(false);
        const [question, setQuestion] = useState('');
        const [files, setFiles] = useState([]);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');
        const [copied, setCopied] = useState(false);
        /** Current conversation: [{question, answer, context, at}]. */
        const [turns, setTurns] = useState([]);
        /** Archived conversations, newest first: [{id, at, turns}]. */
        const [history, setHistory] = useState(() => {
          try { return JSON.parse(localStorage.getItem('dsh-powerup:directask:history:v1') || '[]'); }
          catch { return []; }
        });
        const [showHistory, setShowHistory] = useState(false);
        const [pos, setPos] = useState(() => {
          try {
            const saved = JSON.parse(localStorage.getItem('dsh-powerup:directask:pos:v1') || 'null');
            if (saved !== null && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y };
          } catch { /* fall through */ }
          return { x: 24, y: 96 };
        });
        const [size, setSize] = useState(() => {
          try {
            const saved = JSON.parse(localStorage.getItem('dsh-powerup:directask:size:v1') || 'null');
            if (saved !== null && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
              return { w: Math.max(360, Math.min(1100, saved.w)), h: Math.max(280, Math.min(900, saved.h)) };
            }
          } catch { /* fall through */ }
          return { w: 620, h: 560 };
        });
        const dialogRef = useRef(null);
        const dragRef = useRef(null);
        const bottomRef = useRef(null);
        const sessionRef = useRef(sessionId);
        sessionRef.current = sessionId;
        const t = useCallback((key, params) => translateCurrent(key, params), []);

        const persistHistory = useCallback((next) => {
          setHistory(next);
          try { localStorage.setItem('dsh-powerup:directask:history:v1', JSON.stringify(next.slice(0, 30))); } catch { /* ignore */ }
        }, []);

        useEffect(() => {
          if (!open) return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
          };
          document.addEventListener('keydown', onKey, true);
          return () => document.removeEventListener('keydown', onKey, true);
        }, [open]);

        // Drag (title bar) and resize (bottom-right handle) with native pointers.
        useEffect(() => {
          if (!open) return undefined;
          const onMove = (event) => {
            const drag = dragRef.current;
            if (drag === null) return;
            if (drag.kind === 'move') {
              setPos({
                x: Math.max(0, Math.min(window.innerWidth - 120, drag.px + event.clientX - drag.x)),
                y: Math.max(0, Math.min(window.innerHeight - 60, drag.py + event.clientY - drag.y)),
              });
            } else if (drag.kind === 'resize') {
              setSize({
                w: Math.max(360, Math.min(1100, drag.w + event.clientX - drag.x)),
                h: Math.max(280, Math.min(900, drag.h + event.clientY - drag.y)),
              });
            }
          };
          const onUp = () => {
            if (dragRef.current === null) return;
            dragRef.current = null;
            try {
              localStorage.setItem('dsh-powerup:directask:pos:v1', JSON.stringify(pos));
              localStorage.setItem('dsh-powerup:directask:size:v1', JSON.stringify(size));
            } catch { /* ignore */ }
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          return () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
          };
        }, [open, pos, size]);

        useEffect(() => {
          if (bottomRef.current !== null) bottomRef.current.scrollIntoView?.({ block: 'nearest' });
        }, [turns, busy]);

        const send = useCallback(async () => {
          const q = question.trim();
          if (q === '') { setError(t('directAsk.empty')); return; }
          const priorContext = files.map((f) => ({ name: f.name, text: f.text }));
          // Continuous Q&A: send the current turns as prior messages.
          const historyMsgs = [];
          for (const turn of turns) {
            historyMsgs.push({ role: 'user', text: turn.question });
            if (turn.answer) historyMsgs.push({ role: 'assistant', text: turn.answer });
          }
          setBusy(true);
          setError('');
          setQuestion('');
          setFiles([]);
          setCopied(false);
          try {
            const response = await fetch(DIRECT_ASK_API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId: sessionRef.current ?? '',
                question: q,
                context: priorContext,
                history: historyMsgs,
              }),
            });
            const body = await response.json();
            if (!body?.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
            setTurns((cur) => [...cur, {
              question: q, answer: typeof body.answer === 'string' ? body.answer : '',
              context: priorContext, at: Date.now(),
            }]);
          } catch (err) {
            setError(err?.message ?? String(err));
            setQuestion(q);
          } finally {
            setBusy(false);
          }
        }, [question, files, turns, t]);

        const newChat = useCallback(() => {
          if (turns.length > 0) persistHistory([{ id: String(Date.now()), at: Date.now(), turns }, ...history]);
          setTurns([]);
          setError('');
          setShowHistory(false);
        }, [turns, history, persistHistory]);

        const openArchived = useCallback((entry) => {
          if (turns.length > 0) persistHistory([{ id: String(Date.now()), at: Date.now(), turns }, ...history.filter((h) => h.id !== entry.id)]);
          else persistHistory(history.filter((h) => h.id !== entry.id));
          setTurns(Array.isArray(entry.turns) ? entry.turns : []);
          setShowHistory(false);
        }, [turns, history, persistHistory]);

        const clearHistory = useCallback(() => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm(t('directAsk.clearHistoryConfirm'))) return;
          persistHistory([]);
        }, [t, persistHistory]);

        const pickFiles = useCallback(async (event) => {
          const picked = Array.from(event?.target?.files ?? []);
          const loaded = [];
          for (const file of picked) {
            try {
              const text = await file.text();
              loaded.push({ name: file.name, text: String(text).slice(0, 40_000) });
            } catch {
              /* skip unreadable files */
            }
          }
          setFiles((current) => [...current, ...loaded]);
          if (event?.target) event.target.value = '';
        }, []);

        if (settings.directAsk === false) return null;

        const lightning = h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
          h('path', { d: 'M9 1.5 3.5 9H7l-1 5.5L12.5 7H9l1-5.5Z', fill: 'currentColor' }),
        );

        // Icon-only composer button.
        const button = h('button', {
          type: 'button',
          className: 'dsh-powerup-directask-btn' + (open ? ' on' : ''),
          title: t('directAsk.hint'),
          'aria-label': t('directAsk.label'),
          onClick: () => setOpen((v) => !v),
        }, lightning);

        const dialog = !open ? null : h('div', {
          className: 'dsh-powerup-directask-window',
          style: { left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.w}px`, height: `${size.h}px` },
        },
          h('div', {
            className: 'dsh-powerup-directask-titlebar',
            onPointerDown: (event) => {
              const target = event.target;
              if (target instanceof Element && target.closest('button')) return;
              dragRef.current = { kind: 'move', x: event.clientX, y: event.clientY, px: pos.x, py: pos.y };
            },
          },
            h('span', { className: 'dsh-powerup-directask-title' }, t('directAsk.title')),
            h('span', { className: 'dsh-powerup-directask-subtitle' }, t('directAsk.subtitle')),
            h('button', {
              type: 'button', className: 'dsh-powerup-directask-titlebtn',
              title: t('directAsk.newChat'), onClick: newChat,
            }, '+'),
            h('button', {
              type: 'button', className: 'dsh-powerup-directask-titlebtn' + (showHistory ? ' on' : ''),
              title: t('directAsk.history'), onClick: () => setShowHistory((v) => !v),
            }, '◷'),
            h('button', {
              type: 'button', className: 'dsh-powerup-directask-close',
              'aria-label': t('directAsk.close'), onClick: () => setOpen(false),
            }, '×'),
          ),
          showHistory ? h('div', { className: 'dsh-powerup-directask-history' },
            h('div', { className: 'dsh-powerup-directask-history-head' },
              h('strong', null, t('directAsk.history')),
              h('button', { type: 'button', className: 'dsh-powerup-progress-mini', onClick: clearHistory }, t('directAsk.clearHistory')),
            ),
            history.length === 0
              ? h('p', { className: 'dsh-powerup-progress-empty' }, t('directAsk.historyEmpty'))
              : h('ul', { className: 'dsh-powerup-directask-history-list' },
                history.map((entry) => h('li', { key: entry.id },
                  h('button', { type: 'button', onClick: () => openArchived(entry) },
                    new Date(entry.at ?? Date.now()).toLocaleString(),
                    ' · ', String(entry.turns?.[0]?.question ?? '').slice(0, 40),
                  ),
                )),
              ),
          ) : null,
          h('div', { className: 'dsh-powerup-directask-thread' },
            turns.length === 0 && !busy
              ? h('p', { className: 'dsh-powerup-directask-welcome' }, t('directAsk.showHint'))
              : null,
            turns.map((turn, i) => h('div', { key: i, className: 'dsh-powerup-directask-turn' },
              h('div', { className: 'dsh-powerup-directask-msg user' },
                h('div', { className: 'dsh-powerup-directask-msg-body' }, turn.question),
              ),
              turn.context?.length ? h('div', { className: 'dsh-powerup-directask-ctx' },
                turn.context.map((f, j) => h('span', { key: j }, f.name)),
              ) : null,
              h('div', { className: 'dsh-powerup-directask-msg assistant' },
                h('div', { className: 'dsh-powerup-directask-msg-body' }, turn.answer || '…'),
                h('button', {
                  type: 'button', className: 'dsh-powerup-progress-mini',
                  onClick: async () => {
                    const ok = await copyText(turn.answer);
                    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
                  },
                }, copied ? t('directAsk.copied') : t('directAsk.copy')),
              ),
            )),
            busy ? h('div', { className: 'dsh-powerup-directask-msg assistant' },
              h('div', { className: 'dsh-powerup-directask-msg-body' }, t('directAsk.sending')),
            ) : null,
            h('div', { ref: bottomRef }),
          ),
          error ? h('p', { className: 'dsh-powerup-progress-error' }, error) : null,
          h('div', { className: 'dsh-powerup-directask-composer' },
            files.length > 0 ? h('div', { className: 'dsh-powerup-directask-files' },
              files.map((f, i) => h('span', { key: i, className: 'dsh-powerup-directask-file' },
                f.name,
                h('button', {
                  type: 'button', 'aria-label': t('directAsk.removeFile'),
                  onClick: () => setFiles((cur) => cur.filter((_, j) => j !== i)),
                }, '×'),
              )),
            ) : null,
            h('div', { className: 'dsh-powerup-directask-inputrow' },
              h('label', { className: 'dsh-powerup-directask-attach', title: t('directAsk.attachHint') },
                h('input', { type: 'file', multiple: true, onChange: (e) => void pickFiles(e) }),
                h('span', null, '+'),
              ),
              h('textarea', {
                className: 'dsh-powerup-directask-input',
                value: question,
                placeholder: t('directAsk.placeholder'),
                disabled: busy,
                rows: 1,
                onChange: (event) => setQuestion(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                },
              }),
              h('button', {
                type: 'button', className: 'dsh-powerup-directask-send',
                disabled: busy || question.trim() === '', onClick: () => void send(),
                title: t('directAsk.send'),
              }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
                h('path', { d: 'M3 8h9M8.5 4.5 12 8l-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
            ),
          ),
          h('div', {
            className: 'dsh-powerup-directask-resizer',
            onPointerDown: (event) => {
              event.preventDefault();
              dragRef.current = { kind: 'resize', x: event.clientX, y: event.clientY, w: size.w, h: size.h };
            },
          }),
        );

        return h(React.Fragment, null, button, renderInBody(dialog));
      }

      function DualSendButtons({ sessionId, useInput, inputActions, ctx, t }) {
        const settings = useSettings();
        const draft = typeof useInput === 'function' ? useInput((s) => s.draft) : '';
        // Session-scope slots usually pass sessionId; fall back to the DOM
        // contract the rest of this plugin already relies on.
        const ownerId = () => {
          if (typeof sessionId === 'string' && sessionId !== '') return sessionId;
          try {
            const el = document.querySelector('[data-conversation-session]');
            const id = el === null ? null : el.getAttribute('data-conversation-session');
            return typeof id === 'string' && id !== '' ? id : '';
          } catch {
            return '';
          }
        };
        const trimmed = typeof draft === 'string' ? draft.trim() : '';
        // Dual send only makes sense while the session is actually working:
        // "queue" vs "interrupt" is meaningless on an idle session, where the
        // host's single Send button is the correct affordance.
        const sessionRunning = useSessionRunning(ctx, sessionId);
        // Which strategy the host's own Send button already covers while busy.
        const busyEnter = useHostBusyEnter(ctx);
        const currentDraft = { trimmed, sessionId, inputActions, ctx };
        const send = (mode, text) => {
          const value = typeof text === 'string' ? text.trim() : trimmed;
          const id = ownerId();
          if (value === '' || id === '') return;
          try {
            const sessions = ctx.get('sessions');
            const binding = sessions?.binding?.(id);
            const session = binding?.session;
            if (session === undefined || typeof session.prompt !== 'function') return;
            const handle = typeof session.beginSubmission === 'function'
              ? session.beginSubmission({ mode, text: value, attachments: [] })
              : null;
            void session.prompt([{ type: 'text', text: value }], mode, undefined, handle?.requestId);
            if (typeof inputActions?.setDraft === 'function') inputActions.setDraft('');
          } catch (error) {
            console.warn('[dsh-powerup] dual send failed:', error?.message ?? error);
          }
        };
        // Accelerated Enter (Ctrl/Cmd+Shift+Enter) delivers the strategy the
        // host's plain Enter does NOT use — the same split as the button pair.
        // Plain Enter and Shift+Enter stay entirely with the host so the
        // "busy Enter" setting keeps its meaning.
        useEffect(() => {
          if (!settings.dualSend || typeof document === 'undefined' || document === null) return undefined;
          const onKeyDown = (event) => {
            if (event.key !== 'Enter' || event.isComposing === true || event.repeat === true) return;
            const target = event.target;
            const editor = target !== null && typeof target.closest === 'function'
              ? target.closest('[data-composer-input]')
              : null;
            if (editor === null) return;
            if (editor.hasAttribute('data-composer-composing')) return;
            // An empty draft is the host's retry gesture; leave it alone.
            if (trimmed === '') return;
            // Let the host resolve Enter while a / or @ menu (or a selected
            // command chip) is open — the menu can be portaled outside the card.
            const openMenu = document.querySelector?.(
              '[aria-haspopup="listbox"][aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], [role="listbox"]:not([hidden]), [role="menu"]:not([hidden])',
            );
            if (openMenu !== null && openMenu !== undefined) return;
            if (editor.hasAttribute('data-composer-chip-selected')) return;
            const interrupt = event.shiftKey && (event.ctrlKey || event.metaKey);
            if (!interrupt) return; // plain Enter / Shift+Enter belong to the host
            if (!sessionRunning) return;
            event.preventDefault();
            event.stopPropagation();
            send(busyEnter === 'steer' ? 'queue' : 'steer');
          };
          document.addEventListener('keydown', onKeyDown, true);
          return () => document.removeEventListener('keydown', onKeyDown, true);
        }, [settings.dualSend, sessionId, draft, ctx, inputActions, sessionRunning, busyEnter]);
        void currentDraft;
        // Our extra button only appears while the session is actually working and
        // the draft has text: that is when queue-vs-steer is a real choice. An
        // idle session (or an empty draft) keeps just the native button.
        const active = settings.dualSend && trimmed !== '' && sessionRunning;
        const wrapRef = useRef(null);
        if (!active) return null;
        // The host's own Send button already delivers `busyEnter` (that is the
        // value plain Enter resolves to while busy). So we only contribute the
        // OTHER strategy — one button, never both, and never a duplicate of what
        // the native button does.
        const ours = busyEnter === 'steer' ? 'queue' : 'steer';
        return h('div', { className: 'dsh-powerup-dual-send', ref: wrapRef },
          ours === 'queue'
            ? h('button', {
              type: 'button',
              className: 'dsh-powerup-send',
              'data-kind': 'wait',
              'aria-label': t('send.waitHint'),
              title: t('send.waitHint'),
              disabled: trimmed === '',
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => send('queue'),
            }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
              h('path', { d: 'M3 8h9M8.5 4.5 12 8l-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })))
            : h('button', {
              type: 'button',
              className: 'dsh-powerup-send',
              'data-kind': 'interrupt',
              'aria-label': t('send.interruptHint'),
              title: t('send.interruptHint'),
              disabled: trimmed === '',
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => send('steer'),
            }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
              h('path', { d: 'M8 2v12M3 6l5-4 5 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        );
      }

      /**
       * Conversation View tab for per-workspace Power-Up settings. Registered
       * after Trajectory so it appears last in the header tab row.
       */
      function WorkspaceSettingsView({ ctx, sessionId, useWorkspaces }) {
        const settings = useSettings();
        const rules = useMaskRules();
        const [, forceLocale] = useState(0);
        const t = useCallback((key, params) => translateCurrent(key, params), []);
        useEffect(() => {
          const off = ctx.locale?.subscribe?.(() => forceLocale((v) => v + 1));
          return typeof off === 'function' ? off : undefined;
        }, [ctx]);
        // Prefer the slot's sessionId; fall back to the live DOM contract.
        let ownerId = sessionId;
        if (typeof ownerId !== 'string' || ownerId === '') {
          try {
            const el = document.querySelector('[data-conversation-session]');
            const id = el === null ? null : el.getAttribute('data-conversation-session');
            if (typeof id === 'string' && id !== '') ownerId = id;
          } catch { /* keep the empty id */ }
        }
        const workspaceSelector = useMemo(() => (snapshot) => resolveWorkspaceIdFromSnapshot(snapshot, ownerId), [ownerId]);
        const workspaceId = typeof useWorkspaces === 'function' ? useWorkspaces(workspaceSelector) ?? '' : '';
        useEffect(() => {
          if (typeof workspaceId === 'string' && workspaceId !== '') maskRulesWorkspace = workspaceId;
          void loadWorkspaceMaskRules();
        }, [workspaceId]);
        void rules; void settings;
        return h('div', { className: 'dsh-powerup-page' },
          h('div', { className: 'dsh-powerup-shell' },
            h('header', { className: 'dsh-powerup-hero' },
              h('div', { className: 'dsh-powerup-hero-copy' },
                h('h1', null, t('mask.sessionTitle')),
                h('p', null, t('mask.sessionDesc')),
              ),
            ),
            h(MaskRuleEditor, { scope: 'workspace', t, workspaceId }),
            h(RequirementManager, { ctx, workspaceOnly: true, workspaceId }),
          ),
        );
      }

      function PromptManager({ ctx }) {
        const prompts = usePrompts();
        const groups = usePromptGroups();
        const [, forceLocale] = useState(0);
        const [expanded, setExpanded] = useState(null);
        const [draft, setDraft] = useState(null);
        // Groups start expanded; collapsing one only affects this view.
        const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
        // Group create/rename: { scopeId, id:'', name:'' } (id='' => create).
        const [groupDraft, setGroupDraft] = useState(null);
        // Prompt id currently being dragged. Hover highlight is applied with
        // direct DOM classes, never React state: dragover/dragleave fire
        // continuously and a setState on each one re-renders the whole page,
        // which makes the drop target flash.
        const dragRef = useRef(null);
        const t = (key, params) => translateCurrent(key, params);
        useEffect(() => {
          const locale = ctx.get('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((value) => value + 1));
        }, [ctx]);
        const workspaces = (() => {
          try {
            const service = ctx.get('workspaces');
            const snapshot = service?.list?.getSnapshot?.();
            return Array.isArray(snapshot?.items) ? snapshot.items : [];
          } catch {
            return [];
          }
        })();
        useEffect(() => {
          if (consumeCreateRequest()) {
            setDraft({ id: '', title: '', text: '', workspaceId: '' });
            setExpanded('new');
          }
          return subscribePromptsTab((view) => {
            if (view === 'create') {
              setDraft({ id: '', title: '', text: '', workspaceId: '' });
              setExpanded('new');
            }
          });
        }, []);

        const beginCreate = () => {
          setDraft({ id: '', title: '', text: '', workspaceId: '' });
          setExpanded('new');
        };
        const beginEdit = (prompt) => {
          setDraft({ ...prompt });
          setExpanded(prompt.id);
        };
        const cancelEdit = () => {
          setDraft(null);
          setExpanded(null);
        };
        const save = () => {
          if (draft === null) return;
          const text = typeof draft.text === 'string' ? draft.text.trim() : '';
          if (text === '') {
            console.warn('[dsh-powerup] empty prompt text ignored');
            return;
          }
          const record = {
            id: draft.id || newId(),
            title: typeof draft.title === 'string' ? draft.title.trim() : '',
            text,
            workspaceId: typeof draft.workspaceId === 'string' ? draft.workspaceId.trim() : '',
            groupId: typeof draft.groupId === 'string' ? draft.groupId : '',
          };
          const next = prompts.filter((p) => p.id !== record.id);
          next.push(record);
          writePrompts(next);
          cancelEdit();
        };
        const remove = (prompt) => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm(t('prompts.confirmDelete'))) return;
          writePrompts(prompts.filter((p) => p.id !== prompt.id));
        };

        // ---- Group management ------------------------------------------
        const saveGroup = () => {
          if (groupDraft === null) return;
          const name = typeof groupDraft.name === 'string' ? groupDraft.name.trim() : '';
          if (name === '') return;
          const id = groupDraft.id;
          if (id === '') {
            writeGroups([...groups, {
              id: newId(), kind: 'group', name, workspaceId: groupDraft.scopeId,
            }]);
          } else {
            writeGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
          }
          setGroupDraft(null);
        };
        const deleteGroup = (group) => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm(t('prompts.groupConfirmDelete'))) return;
          // Detach its prompts so none disappear; store both lists in one write.
          writeAll([
            ...groups.filter((g) => g.id !== group.id),
            ...prompts.map((p) => (p.groupId === group.id ? { ...p, groupId: '' } : p)),
          ]);
        };
        /** Clear every drag highlight without touching React state. */
        const clearDragHighlight = () => {
          try {
            for (const node of document.querySelectorAll('[data-drop-highlight].drop-target')) {
              node.classList.remove('drop-target');
            }
          } catch { /* no document in tests */ }
        };
        /** Add the highlight to one node, removing it from all others. */
        const markDropTarget = (node) => {
          if (node === null || node === undefined) return;
          try {
            for (const other of document.querySelectorAll('[data-drop-highlight].drop-target')) {
              if (other !== node) other.classList.remove('drop-target');
            }
            node.classList.add('drop-target');
          } catch { /* no document in tests */ }
        };
        /** Move the dragged prompt into a group ('' = ungrouped) of a scope. */
        const movePrompt = (groupId, scopeId) => {
          const id = dragRef.current;
          dragRef.current = null;
          clearDragHighlight();
          if (typeof id !== 'string' || id === '') return;
          writeAll([
            ...groups,
            ...prompts.map((p) => (p.id === id
              ? { ...p, groupId, workspaceId: scopeId }
              : p)),
          ]);
        };
        const dragOverProps = () => ({
          onDragOver: (event) => {
            event.preventDefault();
            // Cards handle their own reorder hover; let their event bubble here
            // but keep the highlight on the innermost (card) target.
            markDropTarget(event.currentTarget);
          },
          onDragLeave: (event) => {
            // Only clear when the pointer truly leaves this node, not when it
            // moves into a child (relatedTarget is contained in currentTarget).
            const next = event.relatedTarget;
            if (next !== null && typeof event.currentTarget.contains === 'function'
              && event.currentTarget.contains(next)) return;
            event.currentTarget.classList.remove('drop-target');
          },
        });
        const dropProps = (groupId, scopeId) => ({
          ...dragOverProps(),
          onDrop: (event) => {
            event.preventDefault();
            event.stopPropagation();
            movePrompt(groupId, scopeId);
          },
        });
        /**
         * Drop one prompt onto another to reorder inside that group. The array
         * order is the display order within a group, so removing and reinserting
         * before the target card also adopts the target's group/workspace.
         */
        const reorderBefore = (targetId) => {
          const id = dragRef.current;
          dragRef.current = null;
          clearDragHighlight();
          if (typeof id !== 'string' || id === '' || id === targetId) return;
          const moving = prompts.find((p) => p.id === id);
          const target = prompts.find((p) => p.id === targetId);
          if (moving === undefined || target === undefined) return;
          const next = prompts.filter((p) => p.id !== id);
          const moved = {
            ...moving,
            groupId: typeof target.groupId === 'string' ? target.groupId : '',
            workspaceId: typeof target.workspaceId === 'string' ? target.workspaceId : '',
          };
          const idx = next.findIndex((p) => p.id === targetId);
          next.splice(idx < 0 ? next.length : idx, 0, moved);
          writeAll([...groups, ...next]);
        };
        const field = (label, key, placeholder, className) => h('label', { className: 'dsh-powerup-prompt-field' },
          h('span', { className: 'dsh-powerup-prompt-field-label' }, label),
          key === 'text'
            ? h('textarea', {
              className: 'dsh-powerup-prompt-input dsh-powerup-prompt-textarea',
              value: draft?.[key] ?? '',
              placeholder,
              onChange: (event) => setDraft((current) => ({ ...current, [key]: event.target.value })),
            })
            : h('input', {
              className: 'dsh-powerup-prompt-input',
              type: 'text',
              value: draft?.[key] ?? '',
              placeholder,
              onChange: (event) => setDraft((current) => ({ ...current, [key]: event.target.value })),
            }),
        );

        const form = h('div', { className: 'dsh-powerup-prompt-form' },
          field(t('prompts.titleLabel'), 'title', t('prompts.titlePlaceholder')),
          h('label', { className: 'dsh-powerup-prompt-field' },
            h('span', { className: 'dsh-powerup-prompt-field-label' }, t('prompts.workspaceLabel')),
            h(WorkspaceSelect, {
              value: draft?.workspaceId ?? '',
              options: [
                { value: '', label: t('prompts.anyWorkspace') },
                ...workspaces.map((ws) => ({
                  value: ws.workspaceId,
                  label: ws.title || ws.workspaceId,
                  hint: ws.title ? ws.workspaceId : undefined,
                })),
              ],
              onChange: (value) => setDraft((current) => ({ ...current, workspaceId: value })),
              t,
            }),
          ),
          field(t('prompts.textLabel'), 'text', t('prompts.textPlaceholder')),
          h('div', { className: 'dsh-powerup-prompt-form-actions' },
            h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: cancelEdit }, t('prompts.cancel')),
            h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: save }, t('prompts.save')),
          ),
        );

        const workspaceTitleOf = (id) => {
          if (id === '') return t('prompts.anyWorkspace');
          const found = workspaces.find((ws) => ws.workspaceId === id);
          return found?.title || id;
        };

        const toggleGroup = (key) => {
          setCollapsedGroups((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        };

        /** One collapsed prompt card: title + edit/delete, draggable. */
        const promptCard = (prompt, scopeId) => {
          const isExpanded = expanded === prompt.id;
          return h('section', {
            key: prompt.id,
            draggable: !isExpanded,
            'data-prompt-drag': prompt.id,
            'data-drop-highlight': '',
            className: 'dsh-powerup-prompt-card' + (isExpanded ? '' : ' folded'),
            onDragStart: (event) => {
              dragRef.current = prompt.id;
              try { event.dataTransfer?.setData?.('text/plain', prompt.id); } catch { /* best effort */ }
            },
            onDragEnd: () => { dragRef.current = null; clearDragHighlight(); },
            onDragOver: (event) => {
              event.preventDefault();
              event.stopPropagation();
              markDropTarget(event.currentTarget);
            },
            onDragLeave: (event) => {
              const next = event.relatedTarget;
              if (next !== null && typeof event.currentTarget.contains === 'function'
                && event.currentTarget.contains(next)) return;
              event.currentTarget.classList.remove('drop-target');
            },
            onDrop: (event) => {
              event.preventDefault();
              event.stopPropagation();
              reorderBefore(prompt.id);
            },
          },
            h('div', { className: 'dsh-powerup-prompt-card-head' },
              h('span', { className: 'dsh-powerup-prompt-drag-handle', 'aria-hidden': 'true' }, '\u2807'),
              h('span', { className: 'dsh-powerup-prompt-name' }, promptLabel(prompt, t)),
              h('div', { className: 'dsh-powerup-prompt-card-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-powerup-linkbtn',
                  onClick: () => (isExpanded ? cancelEdit() : beginEdit(prompt)),
                }, isExpanded ? t('prompts.cancel') : t('prompts.edit')),
                h('button', {
                  type: 'button',
                  className: 'dsh-powerup-linkbtn danger',
                  onClick: () => remove(prompt),
                }, t('prompts.delete')),
              ),
            ),
            isExpanded ? form : null,
          );
        };

        /** One group block: header (drop target) + collapsible body. */
        const groupBlock = (section, scopeId) => {
          const key = scopeId + ':' + section.id;
          const collapsed = collapsedGroups.has(key);
          const isUngrouped = section.isUngrouped;
          const drop = dropProps(section.id, scopeId);
          const editingThis = groupDraft !== null && groupDraft.scopeId === scopeId
            && groupDraft.id === (isUngrouped ? '' : section.group.id);
          return h('section', {
            key,
            'data-drop-highlight': '',
            className: 'dsh-powerup-prompt-group' + (isUngrouped ? ' dsh-powerup-prompt-ungrouped' : '')
              + (collapsed ? ' is-collapsed' : ''),
            ...drop,
          },
            h('div', { className: 'dsh-powerup-prompt-group-head' },
              h('button', {
                type: 'button',
                className: 'dsh-powerup-prompt-group-toggle',
                'aria-expanded': collapsed ? 'false' : 'true',
                onClick: () => toggleGroup(key),
              },
                h('span', {
                  className: 'dsh-powerup-prompt-group-chevron',
                  'aria-hidden': 'true',
                }, h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none' },
                  h('path', {
                    d: 'm4 6 4 4 4-4',
                    stroke: 'currentColor',
                    strokeWidth: 1.4,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }))),
                h('span', { className: 'dsh-powerup-prompt-group-title' },
                  isUngrouped ? t('prompts.ungrouped') : (section.name || t('prompts.untitled'))),
                h('span', { className: 'dsh-powerup-prompt-group-count' },
                  t('prompts.itemsCount', { count: section.items.length })),
              ),
              !isUngrouped
                ? h('div', { className: 'dsh-powerup-prompt-group-actions' },
                  h('button', {
                    type: 'button', className: 'dsh-powerup-linkbtn',
                    onClick: () => setGroupDraft({ scopeId, id: section.group.id, name: section.name }),
                  }, t('prompts.groupRename')),
                  h('button', {
                    type: 'button', className: 'dsh-powerup-linkbtn danger',
                    onClick: () => deleteGroup(section.group),
                  }, t('prompts.groupDelete')),
                )
                : null,
            ),
            editingThis
              ? h('div', { className: 'dsh-powerup-group-form' },
                h('input', {
                  className: 'dsh-powerup-prompt-input',
                  type: 'text',
                  value: groupDraft.name,
                  placeholder: t('prompts.groupNamePlaceholder'),
                  onChange: (event) => setGroupDraft((current) => ({ ...current, name: event.target.value })),
                }),
                h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: saveGroup },
                  groupDraft.id === '' ? t('prompts.groupCreate') : t('prompts.save')),
                h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: () => setGroupDraft(null) },
                  t('prompts.cancel')),
              )
              : null,
            collapsed ? null : h('div', { className: 'dsh-powerup-prompt-group-body' },
              section.items.map((prompt) => promptCard(prompt, scopeId))),
          );
        };

        // Scopes: global first, then every registered workspace, then orphaned.
        const scopeIds = [];
        if (prompts.some((p) => p.workspaceId === '') || groups.some((g) => g.workspaceId === '')) scopeIds.push('');
        for (const ws of workspaces) {
          if (prompts.some((p) => p.workspaceId === ws.workspaceId)
            || groups.some((g) => g.workspaceId === ws.workspaceId)) scopeIds.push(ws.workspaceId);
        }
        for (const prompt of prompts) {
          if (!scopeIds.includes(prompt.workspaceId)) scopeIds.push(prompt.workspaceId);
        }
        for (const group of groups) {
          if (!scopeIds.includes(group.workspaceId)) scopeIds.push(group.workspaceId);
        }

        const groupsView = scopeIds.length === 0
          ? h('div', { className: 'dsh-powerup-prompt-empty' }, t('prompts.empty'))
          : h('div', { className: 'dsh-powerup-prompt-scopes' }, scopeIds.map((scopeId) => {
            const sub = groupPrompts(prompts, groups, scopeId);
            const creatingGroupHere = groupDraft !== null && groupDraft.scopeId === scopeId && groupDraft.id === '';
            return h('section', { key: 'scope:' + scopeId, className: 'dsh-powerup-prompt-scope' },
              h('div', { className: 'dsh-powerup-prompt-scope-head' },
                h('span', { className: 'dsh-powerup-prompt-scope-title' }, workspaceTitleOf(scopeId)),
                h('button', {
                  type: 'button', className: 'dsh-powerup-linkbtn',
                  onClick: () => setGroupDraft({ scopeId, id: '', name: '' }),
                }, t('prompts.groupNew')),
              ),
              creatingGroupHere
                ? h('div', { className: 'dsh-powerup-group-form' },
                  h('input', {
                    className: 'dsh-powerup-prompt-input', type: 'text', value: groupDraft.name,
                    placeholder: t('prompts.groupNamePlaceholder'),
                    onChange: (event) => setGroupDraft((current) => ({ ...current, name: event.target.value })),
                  }),
                  h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: saveGroup },
                    t('prompts.groupCreate')),
                  h('button', { type: 'button', className: 'dsh-powerup-prompt-new', onClick: () => setGroupDraft(null) },
                    t('prompts.cancel')),
                )
                : null,
              h('div', { className: 'dsh-powerup-prompt-groups' }, sub.map((section) => groupBlock(section, scopeId))),
            );
          }));

        return h('div', null,
          h('div', { className: 'dsh-powerup-prompt-head' },
            h('div', null,
              h('div', { className: 'dsh-powerup-prompt-head-title' }, t('prompts.sectionTitle')),
              h('div', { className: 'dsh-powerup-prompt-head-sub' }, t('prompts.sectionSub')),
            ),
            h('button', {
              type: 'button',
              className: 'dsh-powerup-prompt-new',
              onClick: beginCreate,
            }, t('prompts.new')),
          ),
          expanded === 'new'
            ? h('section', { className: 'dsh-powerup-prompt-card' }, form)
            : null,
          groupsView,
        );
      }

      // ------------------------------------------------------------------
      // Sidebar page
      // ------------------------------------------------------------------
      function PowerUpPage({ ctx }) {
        const settings = useSettings();
        const [, forceLocale] = useState(0);
        const [tab, setTab] = useState('features');
        useEffect(() => {
          const locale = ctx.get('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((value) => value + 1));
        }, [ctx]);
        useEffect(() => {
          if (promptUi.pendingCreateAt !== 0) setTab('prompts');
          return subscribePromptsTab(() => setTab('prompts'));
        }, []);
        useEffect(() => {
          if (settings.workspacePrompts === false && tab === 'prompts') setTab('features');
          if (settings.contentRendering === false && tab === 'mask') setTab('features');
        }, [settings.workspacePrompts, settings.contentRendering, tab]);
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

        /** A host-styled toggle button shared by every feature card. */
        const toggle = (key, label) => {
          const checked = settings[key] !== false;
          return h('button', {
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
          );
        };

        /** One uniform feature card: icon + title + description + toggle, with optional detail rows. */
        const featureCard = (key, iconComp, titleKey, descKey, howKey, detail) => h('section', {
          key,
          className: 'dsh-powerup-card' + (settings[key] === false ? ' is-off' : ''),
        },
          h('div', { className: 'dsh-powerup-card-head' },
            h('div', { className: 'dsh-powerup-card-icon' }, h(iconComp, { size: 18 })),
            h('div', { className: 'dsh-powerup-card-copy' },
              h('h2', null, t(titleKey)),
              h('p', null, t(descKey)),
            ),
            toggle(key, t(titleKey)),
          ),
          howKey !== undefined ? h('p', { className: 'dsh-powerup-card-how' }, t(howKey)) : null,
          detail ?? null,
        );

        /** A label/hint sub-row inside a card (for secondary options). */
        const settingRow = (key, checked, label, hint) => h('div', { key, className: 'dsh-powerup-setting' },
          h('div', { className: 'dsh-powerup-setting-copy' },
            h('span', { className: 'dsh-powerup-setting-label' }, label),
            h('span', { className: 'dsh-powerup-setting-hint' }, hint),
          ),
          toggle(key, label),
        );

        const actionsDetail = h('div', { className: 'dsh-powerup-card-detail' },
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
        );

        const oneClickDetail = h('div', { className: 'dsh-powerup-card-detail' },
          settingRow('oneClickEnable', settings.oneClickEnable !== false, t('page.oneClickEnable'), t('page.oneClickEnableHint')),
          settingRow('oneClickRestart', settings.oneClickRestart !== false, t('page.oneClickRestart'), t('page.oneClickRestartHint')),
        );

        const tabs = h('div', { className: 'dsh-powerup-tabs', role: 'tablist' },
          h('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': tab === 'features' ? 'true' : 'false',
            className: 'dsh-powerup-tab' + (tab === 'features' ? ' on' : ''),
            onClick: () => setTab('features'),
          }, t('prompts.tabFeatures')),
          settings.contentRendering !== false
            ? h('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'mask' ? 'true' : 'false',
              className: 'dsh-powerup-tab' + (tab === 'mask' ? ' on' : ''),
              onClick: () => setTab('mask'),
            }, t('mask.tab'))
            : null,
          settings.workspacePrompts !== false
            ? h('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'prompts' ? 'true' : 'false',
              className: 'dsh-powerup-tab' + (tab === 'prompts' ? ' on' : ''),
              onClick: () => setTab('prompts'),
            }, t('prompts.tabManage'))
            : null,
          settings.taskProgress !== false
            ? h('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'requirements' ? 'true' : 'false',
              className: 'dsh-powerup-tab' + (tab === 'requirements' ? ' on' : ''),
              onClick: () => setTab('requirements'),
            }, t('progress.tabRequirements'))
            : null,
        );

        const featuresContent = h('div', null,
          featureCard('contextMenu', PowerUpLineIcon, 'page.featureTitle', 'page.featureDesc', undefined, actionsDetail),
          featureCard('launcher', LauncherIcon, 'page.launcherTitle', 'page.launcherDesc', undefined,
            h('div', { className: 'dsh-powerup-card-detail' },
              settingRow('launcher', settings.launcher !== false, t('page.launcherToggle'), t('page.launcherToggleHint')),
            ),
          ),
          featureCard('sessionSwitch', QuickIcon, 'page.sessionSwitchTitle', 'page.sessionSwitchDesc', 'page.sessionSwitchHow'),
          featureCard('locateSession', LocateIcon, 'page.locateTitle', 'page.locateDesc', 'page.locateHow'),
          featureCard('scrollToTop', ScrollTopIcon, 'page.scrollToTopTitle', 'page.scrollToTopDesc', 'page.scrollToTopHow'),
          featureCard('contentRendering', PowerUpLineIcon, 'page.renderingTitle', 'page.renderingDesc', 'page.renderingHow'),
          featureCard('dualSend', LauncherIcon, 'page.dualSendTitle', 'page.dualSendDesc', 'page.dualSendHow'),
          featureCard('taskProgress', ProgressIcon, 'page.taskProgressTitle', 'page.taskProgressDesc', 'page.taskProgressHow'),
          featureCard('directAsk', TagIcon, 'page.directAskTitle', 'page.directAskDesc', 'page.directAskHow',
            h('div', { className: 'dsh-powerup-card-detail' },
              settingRow('directAsk', settings.directAsk !== false, t('page.directAskToggle'), t('page.directAskToggleHint')),
            ),
          ),
          featureCard('workspacePrompts', TagIcon, 'page.promptsTitle', 'page.promptsDesc', 'page.promptsHow'),
          featureCard('jobStop', StopIcon, 'page.jobStopTitle', 'page.jobStopDesc', 'page.jobStopHow'),
          featureCard('update', UpdateIcon, 'page.updateTitle', 'page.updateDesc', 'page.updateHow', oneClickDetail),
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
            tabs,
            tab === 'mask' && settings.contentRendering !== false
              ? h(MaskRuleEditor, { scope: 'global', t })
              : tab === 'prompts' && settings.workspacePrompts !== false
                ? h(PromptManager, { ctx })
                : tab === 'requirements' && settings.taskProgress !== false
                  ? h(RequirementManager, { ctx })
                  : featuresContent,
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
      // Task progress: header button + body-portal panel
      // ------------------------------------------------------------------
      const PROGRESS_API = '/dsh-powerup/api/progress';
      const REQUIREMENTS_API = '/dsh-powerup/api/progress-requirements';
      const HISTORY_API = '/dsh-powerup/api/progress-history';
      const DIRECT_ASK_API = '/dsh-powerup/api/direct-ask';

      /** Module-level requirements cache: flat records [{id,title,text,workspaceId,enabled}]. */
      let requirementsCache = [];
      let requirementsLoaded = false;
      const requirementsListeners = new Set();
      function emitRequirements() {
        for (const fn of [...requirementsListeners]) {
          try { fn(); } catch { /* one listener must not break the rest */ }
        }
      }
      function normalizeRequirement(item) {
        if (item === null || typeof item !== 'object') return null;
        return {
          id: typeof item.id === 'string' && item.id !== '' ? item.id : newId(),
          title: typeof item.title === 'string' ? item.title : '',
          text: typeof item.text === 'string' ? item.text : '',
          workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : '',
          enabled: item.enabled !== false,
        };
      }
      async function loadRequirements() {
        if (requirementsLoaded) return requirementsCache;
        requirementsLoaded = true;
        try {
          const response = await fetch(REQUIREMENTS_API, { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (data?.ok && Array.isArray(data.requirements)) {
            requirementsCache = data.requirements.map(normalizeRequirement).filter(Boolean);
          }
        } catch {
          /* Host unavailable: keep the last known value. */
        }
        emitRequirements();
        return requirementsCache;
      }
      function saveRequirements(next) {
        requirementsCache = (Array.isArray(next) ? next : []).map(normalizeRequirement).filter(Boolean);
        emitRequirements();
        fetch(REQUIREMENTS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ requirements: requirementsCache }),
        }).catch(() => { /* in-memory copy still works this session */ });
      }
      function useRequirements() {
        const [, tick] = useState(0);
        useEffect(() => {
          void loadRequirements();
          const listener = () => tick((n) => n + 1);
          requirementsListeners.add(listener);
          return () => requirementsListeners.delete(listener);
        }, []);
        return requirementsCache;
      }
      /** Requirements visible to one workspace: global (''), plus that workspace. */
      function requirementsForWorkspace(list, workspaceId) {
        const id = typeof workspaceId === 'string' ? workspaceId : '';
        return (Array.isArray(list) ? list : [])
          .filter((r) => r.workspaceId === '' || r.workspaceId === id);
      }

      /** Textarea field for one requirements layer. */
      function RequirementField({ label, hint, value, placeholder, onChange }) {
        return h('label', { className: 'dsh-powerup-prompt-field' },
          h('span', { className: 'dsh-powerup-prompt-field-label' }, label),
          hint ? h('span', { className: 'dsh-powerup-setting-hint' }, hint) : null,
          h('textarea', {
            className: 'dsh-powerup-prompt-input dsh-powerup-prompt-textarea',
            value: value ?? '',
            placeholder: placeholder ?? '',
            onChange: (event) => onChange(event.target.value),
          }),
        );
      }

      /**
       * Multi-record requirement manager, modelled on PromptManager: records are
       * scoped to a workspace ('' = global) and can be enabled/disabled, edited
       * and deleted. Used in the Power-Up page's new "Requirements" tab and as
       * the workspace-scoped editor in the conversation settings tab.
       */
      function RequirementManager({ ctx, workspaceOnly, workspaceId }) {
        const reqs = useRequirements();
        const [, forceLocale] = useState(0);
        const [draft, setDraft] = useState(null);
        const [expanded, setExpanded] = useState(null);
        const t = (key, params) => translateCurrent(key, params);
        useEffect(() => {
          const locale = ctx?.get?.('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceLocale((v) => v + 1));
        }, [ctx]);
        const workspaces = (() => {
          try {
            const snapshot = ctx?.get?.('workspaces')?.list?.getSnapshot?.();
            return Array.isArray(snapshot?.items) ? snapshot.items : [];
          } catch { return []; }
        })();
        const visible = workspaceOnly
          ? reqs.filter((r) => r.workspaceId === (typeof workspaceId === 'string' ? workspaceId : ''))
          : reqs;

        const sections = workspaceOnly
          ? [{ id: workspaceId ?? '', label: t('progress.reqWorkspace'), items: visible }]
          : [
            { id: '', label: t('prompts.scopeGlobal'), items: reqs.filter((r) => r.workspaceId === '') },
            ...workspaces.map((ws) => ({
              id: ws.workspaceId,
              label: ws.title ?? ws.workspaceId,
              items: reqs.filter((r) => r.workspaceId === ws.workspaceId),
            })),
          ];

        const cancel = () => { setDraft(null); setExpanded(null); };
        const save = () => {
          if (draft === null) return;
          const text = typeof draft.text === 'string' ? draft.text.trim() : '';
          if (text === '') return;
          const record = {
            id: draft.id || newId(),
            title: typeof draft.title === 'string' ? draft.title.trim() : '',
            text,
            workspaceId: typeof draft.workspaceId === 'string' ? draft.workspaceId : '',
            enabled: draft.enabled !== false,
          };
          const next = reqs.filter((r) => r.id !== record.id);
          next.push(record);
          saveRequirements(next);
          cancel();
        };
        const remove = (record) => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm(t('prompts.confirmDelete'))) return;
          saveRequirements(reqs.filter((r) => r.id !== record.id));
        };
        const toggleEnabled = (record) => {
          saveRequirements(reqs.map((r) => (r.id === record.id ? { ...r, enabled: r.enabled === false } : r)));
        };

        return h('div', { className: 'dsh-powerup-req-manager' },
          h('p', { className: 'dsh-powerup-card-desc' }, t('progress.reqHint')),
          ...sections.map((section) => h('div', { key: `sec-${section.id}` },
            h('h3', { className: 'dsh-powerup-section-title' }, section.label),
            h('ul', { className: 'dsh-powerup-req-list' },
              section.items.map((r) => h('li', { key: r.id, className: 'dsh-powerup-req-item' + (r.enabled === false ? ' off' : '') },
                h('button', {
                  type: 'button', role: 'switch', 'aria-checked': r.enabled !== false ? 'true' : 'false',
                  className: 'dsh-powerup-switch', title: t('page.enabled'),
                  onClick: () => toggleEnabled(r),
                }, r.enabled !== false ? t('page.enabled') : t('page.disabled')),
                h('div', { className: 'dsh-powerup-req-copy' },
                  h('span', { className: 'dsh-powerup-req-title' }, r.title || (r.text.slice(0, 40) + (r.text.length > 40 ? '…' : ''))),
                  h('span', { className: 'dsh-powerup-req-text' }, r.text),
                ),
                h('button', {
                  type: 'button', className: 'dsh-powerup-prompt-new', onClick: () => { setDraft({ ...r }); setExpanded(r.id); },
                }, t('prompts.edit')),
                h('button', {
                  type: 'button', className: 'dsh-powerup-prompt-new', onClick: () => remove(r),
                }, t('prompts.delete')),
              )),
            ),
            expanded === `new-${section.id}` && draft !== null
              ? h(RequirementForm, { draft, setDraft, workspaces, workspaceOnly, scopeId: section.id, t, save, cancel })
              : null,
            h('button', {
              type: 'button', className: 'dsh-powerup-prompt-new',
              onClick: () => { setDraft({ id: '', title: '', text: '', workspaceId: section.id, enabled: true }); setExpanded(`new-${section.id}`); },
            }, t('progress.reqNew')),
          )),
        );
      }

      /** Inline create/edit form for one requirement record. */
      function RequirementForm({ draft, setDraft, workspaces, workspaceOnly, scopeId, t, save, cancel }) {
        return h('div', { className: 'dsh-powerup-req-form' },
          h('input', {
            className: 'dsh-powerup-prompt-input', type: 'text',
            value: draft.title ?? '', placeholder: t('prompts.titlePlaceholder'),
            onChange: (e) => setDraft({ ...draft, title: e.target.value }),
          }),
          h('textarea', {
            className: 'dsh-powerup-prompt-input dsh-powerup-prompt-textarea',
            value: draft.text ?? '', placeholder: t('progress.reqPlaceholder'),
            onChange: (e) => setDraft({ ...draft, text: e.target.value }),
          }),
          !workspaceOnly ? h(WorkspaceSelect, {
            value: draft.workspaceId ?? '',
            options: [{ value: '', label: t('prompts.anyWorkspace') }, ...workspaces.map((ws) => ({ value: ws.workspaceId, label: ws.title ?? ws.workspaceId }))],
            onChange: (value) => setDraft({ ...draft, workspaceId: value }),
            t,
          }) : null,
          h('div', { className: 'dsh-powerup-req-form-foot' },
            h('button', { type: 'button', className: 'dsh-powerup-update-ghost', onClick: cancel }, t('prompts.cancel')),
            h('button', { type: 'button', className: 'dsh-powerup-update-primary', onClick: save }, t('prompts.save')),
          ),
        );
      }

      /** Panel picker: choose which visible requirements to apply for this generation. */
      function RequirementPicker({ reqs, selectedIds, onToggle, t }) {
        if (reqs.length === 0) return h('p', { className: 'dsh-powerup-progress-empty' }, t('progress.reqEmpty'));
        return h('div', { className: 'dsh-powerup-req-picker' },
          reqs.map((r) => h('label', { key: r.id, className: 'dsh-powerup-req-option' },
            h('input', {
              type: 'checkbox', checked: selectedIds.includes(r.id),
              onChange: () => onToggle(r.id),
            }),
            h('span', null, r.title || (r.text.slice(0, 50) + (r.text.length > 50 ? '…' : ''))),
          )),
        );
      }

      /** POST to the progress route; returns the parsed body. */
      async function progressRequest(sessionId, action, extra = {}) {
        const response = await fetch(PROGRESS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, action, ...extra }),
        });
        const body = await response.json();
        if (!body?.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        return body;
      }

      const STATUS_LABEL = {
        pending: '待办', 'in-progress': '进行中', done: '完成', blocked: '受阻',
      };
      const MODE_LABEL = {
        checklist: '任务清单', phases: '阶段', milestones: '里程碑', tree: '任务树',
      };

      /** One status badge. */
      function ProgressBadge(status) {
        return h('span', {
          className: 'dsh-powerup-progress-badge',
          'data-status': status,
        }, STATUS_LABEL[status] ?? status);
      }

      /** Render one node (checklist step / phase / milestone / tree node). */
      function ProgressItem(title, status, detail, children, key) {
        return h('li', { key, className: 'dsh-powerup-progress-item' },
          ProgressBadge(status),
          h('div', { className: 'dsh-powerup-progress-item-copy' },
            h('span', { className: 'dsh-powerup-progress-item-title' }, title),
            detail ? h('span', { className: 'dsh-powerup-progress-item-detail' }, detail) : null,
            Array.isArray(children) && children.length > 0
              ? h('ul', { className: 'dsh-powerup-progress-children' }, children)
              : null,
          ),
        );
      }

      /** Render the model-chosen structured body. */
      function ProgressStructure(report) {
        if (report === null || typeof report !== 'object') return null;
        const sections = [];
        const mode = report.mode ?? 'checklist';
        if (mode === 'phases' && Array.isArray(report.phases) && report.phases.length > 0) {
          sections.push(h('div', { key: 'phases' },
            h('div', { className: 'dsh-powerup-progress-section' }, MODE_LABEL.phases),
            h('ul', { className: 'dsh-powerup-progress-items' }, report.phases.map((phase, i) => ProgressItem(
              phase.name, phase.status, phase.detail,
              Array.isArray(phase.steps) && phase.steps.length > 0
                ? phase.steps.map((s, j) => ProgressItem(s.title, s.status, '', null, `p${i}-s${j}`))
                : null,
              `phase-${i}`,
            ))),
          ));
        } else if (mode === 'milestones' && Array.isArray(report.milestones) && report.milestones.length > 0) {
          sections.push(h('div', { key: 'milestones' },
            h('div', { className: 'dsh-powerup-progress-section' }, MODE_LABEL.milestones),
            h('ul', { className: 'dsh-powerup-progress-items' }, report.milestones.map((m, i) => ProgressItem(
              m.name, m.status, m.criteria ? `${m.detail ?? ''} · ${m.criteria}`.trim() : m.detail,
              null, `m-${i}`,
            ))),
          ));
        } else if (mode === 'tree' && report.tree !== null && report.tree !== undefined) {
          const node = (n, key) => ProgressItem(
            n.title, n.status, n.detail,
            Array.isArray(n.children) && n.children.length > 0 ? n.children.map((c, i) => node(c, `${key}-${i}`)) : null,
            key,
          );
          sections.push(h('div', { key: 'tree' },
            h('div', { className: 'dsh-powerup-progress-section' }, MODE_LABEL.tree),
            h('ul', { className: 'dsh-powerup-progress-items' }, [node(report.tree, 'root')]),
          ));
        } else if (Array.isArray(report.steps) && report.steps.length > 0) {
          sections.push(h('div', { key: 'steps' },
            h('div', { className: 'dsh-powerup-progress-section' }, MODE_LABEL.checklist),
            h('ul', { className: 'dsh-powerup-progress-items' }, report.steps.map((s, i) => ProgressItem(
              s.title, s.status, s.detail, null, `step-${i}`,
            ))),
          ));
        }
        if (Array.isArray(report.blockers) && report.blockers.length > 0) {
          sections.push(h('div', { key: 'blockers', className: 'dsh-powerup-progress-blockers' },
            h('strong', null, '阻碍'),
            h('ul', null, report.blockers.map((b, i) => h('li', { key: i }, b))),
          ));
        }
        return sections.length > 0 ? h('div', null, sections) : null;
      }

      /** Render the model-authored free-form display blocks verbatim. */
      function ProgressDisplay(report) {
        const blocks = Array.isArray(report?.display) ? report.display : [];
        if (blocks.length === 0) return null;
        const rendered = blocks.map((block, i) => {
          if (block.kind === 'text') {
            return h('div', { key: i, className: 'dsh-powerup-progress-display-text' }, block.text);
          }
          if (block.kind === 'kv') {
            return h('dl', { key: i, className: 'dsh-powerup-progress-kv' },
              block.items.map((item, j) => h('div', { key: j, className: 'dsh-powerup-progress-kv-row' },
                h('dt', null, item.label),
                h('dd', null, item.value),
              )),
            );
          }
          if (block.kind === 'callout') {
            return h('div', { key: i, className: 'dsh-powerup-progress-callout', 'data-tone': block.tone }, block.text);
          }
          if (block.kind === 'bars') {
            return h('div', { key: i },
              block.items.map((item, j) => h('div', { key: j, className: 'dsh-powerup-progress-bar' },
                h('div', { className: 'dsh-powerup-progress-bar-head' },
                  h('span', null, item.label),
                  h('span', null, `${item.value}%`),
                ),
                h('div', { className: 'dsh-powerup-progress-track' },
                  h('div', { className: 'dsh-powerup-progress-fill', style: { width: `${item.value}%` } }),
                ),
              )),
            );
          }
          if (block.kind === 'code') {
            return h('pre', { key: i, className: 'dsh-powerup-progress-code' }, block.text);
          }
          return null;
        }).filter(Boolean);
        if (rendered.length === 0) return null;
        return h('div', { className: 'dsh-powerup-progress-display' },
          h('div', { className: 'dsh-powerup-progress-display-head' }, '模型补充'),
          rendered,
        );
      }

      /**
       * Header utility: a resizable, body-portal progress panel.
       *
       * Enhancements over the original:
       *  - wider default panel, user-resizable via a bottom-right drag handle
       *    (size persisted in localStorage);
       *  - header background shifts from blue to warning red as the report ages;
       *  - a per-session history is kept on the Host and can be browsed/cleared;
       *  - the raw AI text is viewable and copyable;
       *  - one-off requirements can be added in the panel for the next refresh.
       */
      function ProgressControl({ sessionId }) {
        const settings = useSettings();
        const [open, setOpen] = useState(false);
        const [view, setView] = useState(null);
        const [busy, setBusy] = useState(false);
        const [historyIndex, setHistoryIndex] = useState(0);
        const [showRaw, setShowRaw] = useState(false);
        const [showReq, setShowReq] = useState(false);
        // Ids of requirement records selected for the next generation.
        const [selectedReqIds, setSelectedReqIds] = useState([]);
        const reqs = useRequirements();
        // Resolve the owning workspace for requirement filtering.
        const workspaceId = useMemo(() => {
          try {
            const snapshot = ctxRef.current?.get?.('workspaces')?.list?.getSnapshot?.();
            return resolveWorkspaceIdFromSnapshot(snapshot, sessionRef.current) ?? '';
          } catch { return ''; }
        }, [sessionId, open]);
        const visibleReqs = requirementsForWorkspace(reqs, workspaceId);
        const [size, setSize] = useState(() => {
          try {
            const saved = JSON.parse(localStorage.getItem('dsh-powerup:progress:size:v1') || 'null');
            if (saved !== null && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
              return { w: Math.max(320, Math.min(900, saved.w)), h: Math.max(240, Math.min(900, saved.h)) };
            }
          } catch { /* fall through */ }
          return { w: 520, h: 560 };
        });
        const [ageTick, setAgeTick] = useState(0);
        const panelRef = useRef(null);
        const buttonRef = useRef(null);
        const dragRef = useRef(null);
        const sessionRef = useRef(sessionId);
        sessionRef.current = sessionId;
        const t = useCallback((key, params) => translateCurrent(key, params), []);

        const refresh = useCallback(async () => {
          const id = sessionRef.current;
          if (typeof id !== 'string' || id === '') return null;
          try {
            const body = await progressRequest(id, 'poll');
            setView(body);
            return body;
          } catch {
            return null;
          }
        }, []);

        // While the panel is open, keep polling until the side call settles.
        useEffect(() => {
          if (!open) return undefined;
          let disposed = false;
          const tick = async () => {
            if (disposed) return;
            const body = await refresh();
            if (disposed) return;
            if (body?.status === 'running') window.setTimeout(tick, 900);
          };
          void tick();
          return () => { disposed = true; };
        }, [open, refresh]);

        // Repaint the time-based header colour once a minute.
        useEffect(() => {
          if (!open) return undefined;
          const timer = window.setInterval(() => setAgeTick((n) => n + 1), 60_000);
          return () => window.clearInterval(timer);
        }, [open]);

        const run = useCallback(async () => {
          const id = sessionRef.current;
          if (typeof id !== 'string' || id === '') return;
          setBusy(true);
          try {
            const body = await progressRequest(id, 'start', { requirementIds: selectedReqIds });
            setView(body);
            setHistoryIndex(0);
          } catch (error) {
            setView({ status: 'error', error: error?.message ?? String(error) });
          } finally {
            setBusy(false);
            if (!open) setOpen(true);
          }
        }, [open, selectedReqIds]);

        const clearHistory = useCallback(async () => {
          const id = sessionRef.current;
          if (typeof id !== 'string' || id === '') return;
          if (window.confirm(t('progress.clearHistoryConfirm')) !== true) return;
          try {
            const body = await progressRequest(id, 'clear');
            setView(body);
            setHistoryIndex(0);
          } catch { /* keep the current view */ }
        }, [t]);

        const close = useCallback(() => setOpen(false), []);

        // Esc and outside click close the panel.
        useEffect(() => {
          if (!open) return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
          };
          const onPointer = (event) => {
            const panel = panelRef.current;
            const button = buttonRef.current;
            if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return;
            if (button !== null && event.target instanceof Node && button.contains(event.target)) return;
            close();
          };
          document.addEventListener('keydown', onKey, true);
          document.addEventListener('pointerdown', onPointer, true);
          return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onPointer, true);
          };
        }, [open, close]);

        // Bottom-right resize handle: ordinary pointer events on the panel node.
        useEffect(() => {
          if (!open) return undefined;
          const onMove = (event) => {
            const drag = dragRef.current;
            if (drag === null) return;
            const w = Math.max(320, Math.min(900, drag.w + drag.x - event.clientX));
            const h = Math.max(240, Math.min(900, drag.h + event.clientY - drag.y));
            setSize({ w, h });
          };
          const onUp = () => {
            if (dragRef.current === null) return;
            dragRef.current = null;
            try { localStorage.setItem('dsh-powerup:progress:size:v1', JSON.stringify(size)); } catch { /* ignore */ }
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          return () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
          };
        }, [open, size]);

        if (settings.taskProgress === false) return null;
        const running = view?.status === 'running' || busy;
        const history = Array.isArray(view?.history) ? view.history : [];
        // The selected history entry is the displayed report; index 0 = latest.
        const selected = history.length > 0
          ? history[Math.min(historyIndex, history.length - 1)]
          : null;
        const report = selected?.report ?? selected ?? view?.report;

        // Age of the displayed report, used for the blue → red header gradient.
        // `ageTick` forces this recomputation once a minute while open.
        void ageTick;
        const reportAt = selected?.updatedAt ?? view?.updatedAt ?? 0;
        const ageMinutes = reportAt > 0 ? (Date.now() - reportAt) / 60_000 : 0;
        // 0 min → blue (210), 60+ min → red (0). Keep a hint of blue until 15 min.
        const hue = Math.max(0, 210 - Math.min(60, ageMinutes) * 3.5);
        const headerStyle = reportAt > 0
          ? { background: `linear-gradient(90deg, hsl(${hue} 70% 42% / 0.22), hsl(${hue} 70% 42% / 0.06))` }
          : undefined;

        const button = h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'dsh-powerup-progress-btn' + (running ? ' is-running' : ''),
          title: t('progress.title'),
          'aria-label': t('progress.title'),
          onClick: () => {
            if (open) { close(); return; }
            setOpen(true);
            void refresh();
          },
        },
          h(ProgressIcon, { size: 15 }),
          h('span', null, t('progress.label')),
          running ? h('span', { className: 'dsh-powerup-progress-btn-dot' }) : null,
        );

        const reportBody = (() => {
          if (report === null || report === undefined) return null;
          return h('div', null,
            h('p', { className: 'dsh-powerup-progress-summary' }, report.summary),
            h('div', { className: 'dsh-powerup-progress-meter' },
              h('div', { className: 'dsh-powerup-progress-meter-head' },
                h('span', null, MODE_LABEL[report.mode] ?? report.mode),
                h('strong', null, `${report.percent}%`),
              ),
              h('div', { className: 'dsh-powerup-progress-track' },
                h('div', { className: 'dsh-powerup-progress-fill', style: { width: `${report.percent}%` } }),
              ),
            ),
            ProgressStructure(report),
            ProgressDisplay(report),
          );
        })();

        const body = (() => {
          if (view === null) return h('div', { className: 'dsh-powerup-progress-empty' }, t('progress.hint'));
          if (view.status === 'error') return h('p', { className: 'dsh-powerup-progress-error' }, view.error ?? t('progress.failed'));
          if (running) {
            return h('div', null,
              h('div', { className: 'dsh-powerup-progress-loading' }, t('progress.loading')),
              reportBody,
            );
          }
          if (showRaw) {
            const raw = typeof report?.raw === 'string' ? report.raw : '';
            return h('div', null,
              h('h4', { className: 'dsh-powerup-progress-section' }, t('progress.rawTitle')),
              h('p', { className: 'dsh-powerup-progress-empty' }, t('progress.rawHint')),
              h('pre', { className: 'dsh-powerup-progress-code' }, raw || '(empty)'),
              h('button', {
                type: 'button', className: 'dsh-powerup-progress-refresh',
                onClick: () => void copyText(raw),
              }, t('progress.copyRaw')),
            );
          }
          if (report === null || report === undefined) {
            return h('div', null,
              h('p', { className: 'dsh-powerup-progress-empty' }, t('progress.empty')),
              h('button', {
                type: 'button', className: 'dsh-powerup-progress-refresh',
                disabled: busy, onClick: () => void run(),
              }, t('progress.generate')),
            );
          }
          return h('div', null,
            // History switcher — browsing an older report never discards it.
            history.length > 1 ? h('div', { className: 'dsh-powerup-progress-history' },
              h('span', { className: 'dsh-powerup-progress-section' }, t('progress.history')),
              h('div', { className: 'dsh-powerup-progress-history-list' },
                history.map((entry, index) => h('button', {
                  key: entry.updatedAt ?? index,
                  type: 'button',
                  className: 'dsh-powerup-progress-history-item' + (index === historyIndex ? ' on' : ''),
                  onClick: () => setHistoryIndex(index),
                }, new Date(entry.updatedAt ?? Date.now()).toLocaleTimeString())),
              ),
            ) : null,
            ageMinutes > 15 ? h('p', { className: 'dsh-powerup-progress-age' },
              t('progress.ageWarning', { minutes: Math.round(ageMinutes) }),
            ) : null,
            reportBody,
          );
        })();

        const requirementsEditor = showReq ? h('div', { className: 'dsh-powerup-progress-req-pop' },
          h('span', { className: 'dsh-powerup-prompt-field-label' }, t('progress.reqSelect')),
          h('p', { className: 'dsh-powerup-setting-hint' }, t('progress.reqSelectHint')),
          h(RequirementPicker, {
            reqs: visibleReqs,
            selectedIds: selectedReqIds,
            t,
            onToggle: (id) => setSelectedReqIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]),
          }),
        ) : null;

        const panel = !open ? null : h('div', {
          ref: panelRef,
          className: 'dsh-powerup-progress-panel',
          style: {
            width: `${size.w}px`,
            maxHeight: `${size.h}px`,
            top: (() => {
              const rect = buttonRef.current?.getBoundingClientRect?.();
              return `${Math.round((rect?.bottom ?? 44) + 6)}px`;
            })(),
            right: (() => {
              const rect = buttonRef.current?.getBoundingClientRect?.();
              return `${Math.round(Math.max(12, window.innerWidth - (rect?.right ?? window.innerWidth - 12)))}px`;
            })(),
          },
        },
          h('div', { className: 'dsh-powerup-progress-head', style: headerStyle },
            h('div', { className: 'dsh-powerup-progress-heading' },
              h('span', { className: 'dsh-powerup-progress-title' }, report?.title ?? t('progress.title')),
              h('span', { className: 'dsh-powerup-progress-sub' },
                view?.stale ? `${t('progress.stale')} · ` : '',
                t('progress.subtitle'),
              ),
            ),
            h('button', {
              type: 'button', className: 'dsh-powerup-progress-close',
              'aria-label': t('progress.close'), onClick: close,
            }, '×'),
          ),
          requirementsEditor,
          h('div', { className: 'dsh-powerup-progress-body' }, body),
          h('div', { className: 'dsh-powerup-progress-foot' },
            h('span', { className: 'dsh-powerup-progress-time' },
              view?.updatedAt ? format(t('progress.updated'), { time: new Date(view.updatedAt).toLocaleTimeString() }) : '',
            ),
            h('button', {
              type: 'button', className: 'dsh-powerup-progress-mini',
              onClick: () => setShowReq((v) => !v),
            }, t('progress.requirements')),
            report?.raw ? h('button', {
              type: 'button', className: 'dsh-powerup-progress-mini',
              onClick: () => setShowRaw((v) => !v),
            }, t('progress.viewRaw')) : null,
            history.length > 0 ? h('button', {
              type: 'button', className: 'dsh-powerup-progress-mini',
              onClick: () => void clearHistory(),
            }, t('progress.clearHistory')) : null,
            h('button', {
              type: 'button', className: 'dsh-powerup-progress-refresh',
              disabled: busy || running, onClick: () => void run(),
            }, t('progress.refresh')),
          ),
          h('div', {
            className: 'dsh-powerup-progress-resizer',
            title: t('progress.resizeHint'),
            onPointerDown: (event) => {
              event.preventDefault();
              dragRef.current = { x: event.clientX, y: event.clientY, w: size.w, h: size.h };
            },
          }),
        );

        return h('span', { style: { display: 'inline-flex', alignItems: 'center' } },
          button,
          renderInBody(panel),
        );
      }

      // ------------------------------------------------------------------
      // Plugin body
      // ------------------------------------------------------------------
      function apply(ctx) {
        ctxRef.current = ctx;
        ctx.effect(() => () => {
          if (ctxRef.current === ctx) ctxRef.current = null;
        }, 'dsh-powerup: client context');
        bindLocale(ctx);
        installStyles(ctx);
        installLauncher(ctx);
        installSessionSwitcher(ctx);
        installLocateSession(ctx);
        installScrollToTop(ctx);
        installReplyMask(ctx);

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

        register('conversation.session.header.utilities', {
          id: 'powerup-progress',
          order: 52,
        }, (props) => h(ProgressControl, { sessionId: props?.sessionId }), 'dsh-powerup: task progress');

        register('conversation.hero.options', {
          id: 'powerup-prompts',
          order: 60,
        }, HeroPromptsControl, 'dsh-powerup: prompt picker');

        // Session-scope composer controls. These receive sessionId/useInput/
        // inputActions from the host's conversation slot wiring; the t() locale
        // seat is provided by the slot, so we wrap to use the plugin dictionary.
        register('conversation.input.right', {
          id: 'powerup-dual-send',
          order: 80,
        }, (props) => h(DualSendButtons, {
          ...props,
          ctx,
          t: (key, params) => translateCurrent(key, params),
        }), 'dsh-powerup: dual send buttons');

        register('conversation.input.right', {
          id: 'powerup-direct-ask',
          order: 82,
        }, (props) => h(DirectAskButton, { sessionId: props?.sessionId }), 'dsh-powerup: direct ask');

        // In an ongoing session, place the prompt picker in the bottom tool row
        // just after the host's permission / plan dropdowns; its popover opens
        // upward so it is not clipped by the screen bottom.
        register('conversation.input.left', {
          id: 'powerup-prompts-composer',
          order: 10,
        }, ComposerPromptsControl, 'dsh-powerup: composer prompt picker');

        // Per-workspace Power-Up settings as a Conversation View tab, ordered
        // after the host's Trajectory view (order 10).
        register('conversation.view', {
          id: 'powerup-settings',
          order: 20,
          label: () => translateCurrent('mask.viewTabLabel'),
        }, (props) => h(WorkspaceSettingsView, { ...props, ctx }), 'dsh-powerup: workspace settings view');

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
        // `configForms` is optional: it carries the Host "busy Enter" preference.
        // Read through ctx.get with a defensive fallback instead of a hard
        // inject dependency, so a deployment without the settings service still
        // gets every other Power-Up feature.
        inject: ['slots', 'locale'],
        apply,
        // Exported for smoke tests only; the host never reads this.
        __test: {
          DICT,
          CSS,
          SESSION_SWITCH_CSS,
          LOCATE_CSS,
          SCROLL_TOP_CSS,
          RENDERING_CSS,
          PROMPTS_CSS,
          PROGRESS_CSS,
          ProgressControl,
          RequirementManager,
          RequirementPicker,
          requirementForWorkspace: requirementsForWorkspace,
          DirectAskButton,
          ProgressStructure,
          ProgressDisplay,
          progressRequest,
          PROMPTS_LAST_KEY,
          promptCreateDraft,
          readPrompts,
          writePrompts,
          readGroups,
          writeGroups,
          writeAll,
          groupPrompts,
          promptsForWorkspace,
          promptLabel,
          readLastPrompt,
          writeLastPrompt,
          resolveWorkspaceIdFromSnapshot,
          openPromptPopover,
          PromptCreateModal,
          HeroPromptsControl,
          PromptManager,
          runningSessionRows,
          buildWorkspaceIndex,
          createSessionSwitcherCore,
          createLocateSessionCore,
          createScrollToTopCore,
          LocateIcon,
          ScrollTopIcon,
          LAUNCHER_CSS,
          LAUNCHER_STORAGE_KEY,
          LAUNCHER_CHAT_KEY,
          LAUNCHER_RESTART_KEY,
          LAUNCHER_RESTART_ICON,
          LAUNCHER_CLOSE_KEY,
          LAUNCHER_MORE_KEY,
          LAUNCHER_CLOSE_ICON,
          normalizeLauncherState,
          dissolveGroupOrder,
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
          MASK_RULES_KEY,
          MASK_PLACEHOLDER,
          readGlobalMaskRules,
          writeGlobalMaskRules,
          normalizeMaskRule,
          activeMaskRules,
          compileMaskRules,
          applyMaskRules,
          createReplyMaskCore,
          DualSendButtons,
          MaskRuleEditor,
          WorkspaceSettingsView,
        },
      };
    },
  });
})();
