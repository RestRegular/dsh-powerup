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

      const NS = 'dsh-powerup';
      const SETTINGS_KEY = 'dsh-powerup:settings:v1';
      const VERSION = '0.2.3';
      const MENU_GAP = 8;
      const MENU_WIDTH = 248;

      // ------------------------------------------------------------------
      // Dictionaries
      // ------------------------------------------------------------------
      const DICT = {
        zh: {
          'panel.title': 'Power-Up',
          'page.title': 'Power-Up',
          'page.subtitle': '给 DeepSeek Harness 加一点助推。',
          'page.featureTitle': '轨迹右键菜单',
          'page.featureDesc': '在轨迹页面右键任意记录，快速复制、引用、查看详情，或从该记录 Fork 出一个新会话。',
          'page.enabled': '已启用',
          'page.disabled': '已停用',
          'page.actions': '可用操作',
          'page.howTitle': '怎么用',
          'page.how1': '打开任意会话，切到顶部的「轨迹」视图。',
          'page.how2': '在记录行上右键；在空白处右键可执行会话级操作。',
          'page.how3': '菜单支持 ↑ / ↓ 选择、Enter 执行、Esc 关闭。',
          'page.updateTitle': '插件自更新',
          'page.updateDesc': '在插件页为每个第三方已安装插件提供更新入口：从安装源选版本、卸载旧版、按「添加插件」流程重装，并可立即启用与重启 DSH。',
          'page.updateHow': '打开侧边栏的「插件」页，在「已安装插件」分组中点击卡片右侧的更新图标。',
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
          'toast.forkUnavailable': '当前宿主没有提供 Fork 接口',
          'toast.noSession': '还没有打开会话',
          'update.button': '更新版本',
          'update.title': '更新插件',
          'update.subtitle': '选择版本后自动卸载旧版并安装新版本。',
          'update.current': '当前版本',
          'update.versionLabel': '版本号',
          'update.versionPlaceholder': '输入版本号，或从列表选择',
          'update.loadingVersions': '正在从安装源读取版本…',
          'update.loading': '正在读取插件信息…',
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
          'update.start': '开始更新',
          'update.cancel': '取消',
          'update.close': '关闭',
          'update.step.checking': '正在校验版本…',
          'update.step.removing': '正在卸载旧版…',
          'update.step.installing': '正在安装 {version}…',
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
          'update.doneTitle': '更新完成',
          'update.doneInstalled': '{name} 已更新到 {version}。',
          'update.doneDisabled': '{name} 已安装 {version}，尚未启用。',
          'update.doneEnabled': '新版本已启用。',
          'update.doneRestart': '部分更改需要重启 DSH 后生效。',
          'update.doneButton': '完成',
          'update.errorTitle': '更新失败',
          'update.selfTitle': '请用「添加插件」更新 Power-Up 自身',
          'update.selfDesc': '更新 Power-Up 会先卸载本插件，更新流程会随之中断。',
          'update.notRemovable': '该插件受 DSH 管理，不能在这里更新。',
          'update.notBundle': '该包不是 DSH 插件包。',
          'update.alreadyInstalled': '该包已安装，请先卸载旧版本。',
          'update.notFound': '安装源里找不到这个版本。',
          'update.cancelled': '更新已取消。',
          'update.installedChip': '未安装',
          'update.unknown': '未知错误',
          'update.invalidVersion': '请输入有效版本号（例如 1.2.3）',
          'update.stopProfile': '当前 profile 不能热卸载该插件，请重启 DSH 后再试。',
          'update.unsupportedTitle': '无法自动更新',
        },
        en: {
          'panel.title': 'Power-Up',
          'page.title': 'Power-Up',
          'page.subtitle': 'A little boost for DeepSeek Harness.',
          'page.featureTitle': 'Trajectory context menu',
          'page.featureDesc': 'Right-click any trajectory record to copy it, quote it, open its inspector, or fork the session at that point.',
          'page.enabled': 'Enabled',
          'page.disabled': 'Disabled',
          'page.actions': 'What you can do',
          'page.howTitle': 'How to use it',
          'page.how1': 'Open a session and switch to the Trajectory view.',
          'page.how2': 'Right-click a record row; right-click empty space for session actions.',
          'page.how3': 'Use ↑ / ↓ to move, Enter to run, Esc to close.',
          'page.updateTitle': 'Update plugins',
          'page.updateDesc': 'Every third-party plugin on the Plugins page gains an update entry: pick a version from a registry, remove the old copy, reinstall through the Add plugin path, then enable and restart DSH.',
          'page.updateHow': 'Open Plugins in the sidebar and click the update icon at the right of a card under Installed plugins.',
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
          'toast.forkUnavailable': 'This host does not expose the fork API',
          'toast.noSession': 'No session is open',
          'update.button': 'Update version',
          'update.title': 'Update plugin',
          'update.subtitle': 'Choose a version; the old one is removed and the new one installed.',
          'update.current': 'Current version',
          'update.versionLabel': 'Version',
          'update.versionPlaceholder': 'Type a version or pick one from the list',
          'update.loadingVersions': 'Reading versions from the registry…',
          'update.loading': 'Reading the plugin…',
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
          'update.start': 'Update',
          'update.cancel': 'Cancel',
          'update.close': 'Close',
          'update.step.checking': 'Checking the version…',
          'update.step.removing': 'Removing the old version…',
          'update.step.installing': 'Installing {version}…',
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
          'update.doneTitle': 'Update complete',
          'update.doneInstalled': '{name} is now on {version}.',
          'update.doneDisabled': '{name} {version} is installed but not enabled.',
          'update.doneEnabled': 'The new version is enabled.',
          'update.doneRestart': 'Some changes apply only after DSH restarts.',
          'update.doneButton': 'Done',
          'update.errorTitle': 'Update failed',
          'update.selfTitle': 'Update Power-Up with Add plugin',
          'update.selfDesc': 'Updating Power-Up removes this plugin first, which interrupts this flow.',
          'update.notRemovable': 'DSH manages this plugin; it cannot be updated here.',
          'update.notBundle': 'This package is not a DSH plugin bundle.',
          'update.alreadyInstalled': 'This package is already installed; remove the old version first.',
          'update.notFound': 'That version is not available from the registry.',
          'update.cancelled': 'The update was cancelled.',
          'update.installedChip': 'Not installed',
          'update.unknown': 'Unknown error',
          'update.invalidVersion': 'Enter a valid version, for example 1.2.3.',
          'update.stopProfile': 'This profile cannot hot-remove the plugin; restart DSH and try again.',
          'update.unsupportedTitle': 'Cannot update automatically',
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
      function readSettings() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
          if (parsed !== null && typeof parsed === 'object') {
            return { enabled: parsed.enabled !== false };
          }
        } catch {
          /* Private mode or a corrupted value: use the default. */
        }
        return { enabled: true };
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
.dsh-powerup-update-button{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}
.dsh-powerup-update-button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}
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
.dsh-powerup-update-list{display:flex;flex-direction:column;max-height:240px;overflow-y:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-update-popover{position:fixed;z-index:1300;box-sizing:border-box;overflow-y:auto;pointer-events:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-powerup-update-popover.dsh-powerup-update-list{border-radius:var(--dsw-radius-lg,10px)}
.dsh-powerup-update-popover.dsh-powerup-update-select-menu{display:flex;flex-direction:column;padding:4px}
.dsh-powerup-update-list-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-powerup-update-version{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 12px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
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
.dsh-powerup-update-select-trigger{display:flex;align-items:center;gap:10px;width:100%;height:38px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease}
.dsh-powerup-update-select-trigger:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-powerup-update-select-trigger[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dsh-powerup-update-select-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-powerup-update-select-host{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-powerup-update-select-trigger .chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
.dsh-powerup-update-select-trigger[aria-expanded=true] .chevron{transform:rotate(180deg)}
.dsh-powerup-update-select-menu{display:flex;flex-direction:column;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dsh-powerup-update-option{display:flex;align-items:flex-start;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dsh-powerup-update-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-option[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-update-option-copy{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0}
.dsh-powerup-update-option-title{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px}
.dsh-powerup-update-option-host{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.dsh-powerup-update-option .dsh-powerup-update-check{flex:none;margin-top:2px}
.dsh-powerup-update-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 24px 22px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-powerup-update-primary{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;line-height:22px;cursor:pointer;transition:background .14s ease}
.dsh-powerup-update-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsh-powerup-update-primary:disabled{opacity:.4;cursor:not-allowed}
.dsh-powerup-update-ghost{height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-powerup-update-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-powerup-update-ghost:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-powerup-update-close:focus-visible,.dsh-powerup-update-toggle:focus-visible,.dsh-powerup-update-version:focus-visible,.dsh-powerup-update-select-trigger:focus-visible,.dsh-powerup-update-option:focus-visible,.dsh-powerup-update-primary:focus-visible,.dsh-powerup-update-ghost:focus-visible,.dsh-powerup-update-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
@media (max-width:680px){.dsh-powerup-page{padding:20px 16px 42px}.dsh-powerup-actions{grid-template-columns:minmax(0,1fr)}.dsh-powerup-hero-art{width:54px;height:54px}.dsh-powerup-hero h1{font-size:19px}.dsh-powerup-card-head{flex-wrap:wrap}.dsh-powerup-switch{margin-left:auto}.dsh-powerup-update-mask{padding:12px}.dsh-powerup-update-dialog{max-height:calc(100dvh - 24px)}.dsh-powerup-update-head{padding:18px 12px 10px 18px}.dsh-powerup-update-body{padding:0 18px 4px}.dsh-powerup-update-foot{padding:14px 18px 18px}}
`;

      function installStyles(ctx) {
        try {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-powerup', '');
          style.textContent = CSS;
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
      const UPDATE_API = '/dsh-powerup/api/restart';
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
       * The registry choices the update dialog offers: the Host's configured
       * default (with the URL pnpm actually names), each configured fallback,
       * and a remembered custom address.
       * @param {{ registry: string | null, fallbackRegistries: string[], resolved: string | null } | null} registries
       * @param {object | null} remembered
       * @param {(key: string) => string} t
       * @returns {Array<{ key: string, label: string, hint: string, value: string | null, url: string }>}
       */
      function buildRegistryChoices(registries, remembered, t) {
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
       * Choose the offered registry matching what the Add dialog remembered.
       * @param {Array<{ key: string, value: string | null, url: string }>} choices
       * @param {object | null} remembered
       * @returns {object}
       */
      function pickRegistryChoice(choices, remembered) {
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

      /** The glyph on the injected card button (static; no external asset). */
      const UPDATE_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M8 10.6V3.1M5.2 5.9 8 3.1l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.9 10.4v1A1.6 1.6 0 0 0 4.5 13h7a1.6 1.6 0 0 0 1.6-1.6v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

      /** Tooltip/accessible label for one injected update button. */
      function updateButtonLabel(name, t) {
        return name === MODULE_ID ? t('update.selfTitle') : `${t('update.button')} · ${name}`;
      }

      /**
       * Ensure every third-party card in the built-in "Installed plugins"
       * group carries one update button. Idempotent, so React re-renders and
       * the observer can call it repeatedly.
       * @param {Document} doc
       * @param {(name: string) => void} open
       * @param {(key: string, params?: object) => string} t
       * @param {Set<Element>} buttons
       */
      function ensureUpdateButtons(doc, open, t, buttons) {
        if (doc === null || doc === undefined || typeof doc.querySelectorAll !== 'function') return;
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
        }
        for (const button of [...buttons]) if (button.isConnected !== true) buttons.delete(button);
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
       * The Plugins-page update control. It injects one icon button into each
       * third-party card of the built-in "Installed plugins" group, then owns
       * the dialog that removes the old version, installs the selected one
       * through the same `pluginManager` Remote the Add plugin dialog uses,
       * asks about enabling, and offers to restart DSH.
       */
      function PluginUpdateOverlay({ manager, remote, ctx }) {
        const [view, setView] = useState(null);
        const [localeTick, forceLocale] = useState(0);
        const tokenRef = useRef(null);
        const abortRef = useRef(null);
        const buttonsRef = useRef(new Set());
        const inputRef = useRef(null);
        const versionRef = useRef(null);
        const versionPanelRef = useRef(null);
        const registryRef = useRef(null);
        const registryPanelRef = useRef(null);
        const versionSeq = useRef(0);
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
          if (current !== null && (current.phase === 'working' || current.phase === 'restarting' || current.enabling === true)) return;
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

        const loadVersions = useCallback(async (token, name, choice, choices, resetVersion) => {
          const t = tRef.current;
          const seq = versionSeq.current + 1;
          versionSeq.current = seq;
          const current = () => versionSeq.current === seq && tokenRef.current === token;
          patch(token, { versionsState: 'loading', versionsError: null, versionsRegistry: null, ...(resetVersion === true ? { versions: [], version: '' } : {}) });
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
            currentVersion: null,
            phase: 'loading',
            step: null,
            choices: [],
            registryKey: '',
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
          if (name === MODULE_ID) {
            patch(token, { phase: 'self' });
            return;
          }
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
            const choices = buildRegistryChoices(registries.ok ? registries.value : null, remembered, t);
            const choice = pickRegistryChoice(choices, remembered);
            patch(token, {
              title: packageDisplayTitle(pkg),
              currentVersion: pkg.version ?? null,
              installed: pkg.installed === true,
              phase: 'choose',
              choices,
              registryKey: choice.key,
              versionsState: 'loading',
            });
            await loadVersions(token, name, choice, choices, false);
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
            ensureUpdateButtons(document, (name) => openRef.current(name), tRef.current, buttons);
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
        }, [localeTick]);

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

        const startUpdate = async () => {
          const token = tokenRef.current;
          const current = view;
          if (token === null || current === null || current.phase !== 'choose') return;
          const t = tRef.current;
          const version = normalizeVersionInput(current.version);
          if (version === '') {
            setView((state) => state === null ? state : { ...state, formError: t('update.invalidVersion') });
            return;
          }
          const choice = current.choices.find((item) => item.key === current.registryKey) ?? current.choices[0];
          const registry = registryValue(choice);
          const spec = `${current.name}@${version}`;
          const requestId = newRequestId();
          patch(token, { phase: 'working', step: 'removing', error: null, formError: null, log: '', logLabel: spec });
          try {
            // The update flow removes the old version first: the Host's
            // inspection refuses a package that is still installed, so the
            // version is checked after removal, exactly where Add plugin
            // performs its own check.
            const removed = await manager.removeBundle(current.name);
            if (tokenRef.current !== token) return;
            if (!removed.ok) throw new Error(removed.error?.message ?? t('update.unknown'));
            if (removed.value.error !== undefined) throw new Error(operationReason(removed.value, t));
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
            patch(token, {
              phase: 'enable',
              step: null,
              installedVersion: value.version ?? version,
              restartRequired: value.application === 'restart-required',
              enabling: false,
            });
          } catch (error) {
            patch(token, { phase: 'error', step: null, error: errorText(error) || t('update.unknown') });
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
            const response = await fetch(UPDATE_API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'restart' }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? `HTTP ${response.status}`);
            patch(token, { phase: 'restarting', restarting: true });
          } catch (error) {
            patch(token, { restarting: false, restartError: errorText(error) || t('update.unknown') });
          }
        };

        if (view === null) return null;
        const t = (key, params) => translateCurrent(key, params);
        const busy = view.phase === 'working' || view.phase === 'restarting' || view.enabling === true;
        const canClose = !busy;
        const title = view.title === undefined || view.title === '' ? view.name : view.title;
        const showVersions = view.phase === 'choose' && view.listOpen === true;

        const footer = (() => {
          if (view.phase === 'choose') {
            return [
              h('button', { key: 'cancel', type: 'button', className: 'dsh-powerup-update-ghost', onClick: close }, t('update.cancel')),
              h('button', {
                key: 'start',
                type: 'button',
                className: 'dsh-powerup-update-primary',
                disabled: view.versionsState === 'loading' || String(view.version ?? '').trim() === '',
                onClick: startUpdate,
              }, t('update.start')),
            ];
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
          if (view.phase === 'restarting' || view.phase === 'working' || view.phase === 'loading') return [];
          return [
            h('button', { key: 'done', type: 'button', className: 'dsh-powerup-update-primary', onClick: close }, view.phase === 'done' ? t('update.doneButton') : t('update.close')),
          ];
        })();

        /** One tinted notice: the success/warn/error states share this chrome. */
        const notice = (tone, icon, title, message) => h('div', { className: `dsh-powerup-update-notice ${tone}` },
          icon,
          h('div', { className: 'dsh-powerup-update-notice-copy' },
            title === null || title === undefined ? null : h('span', { className: 'dsh-powerup-update-notice-title' }, title),
            message === null || message === undefined ? null : h('span', null, message),
          ),
        );

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
          if (view.phase === 'self') {
            return notice('warn', h(WarnIcon, { size: 15 }), t('update.selfTitle'), t('update.selfDesc'));
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
            ];
          }
          if (view.phase === 'working') {
            const label = view.step === 'removing'
              ? t('update.step.removing')
              : view.step === 'installing'
                ? t('update.step.installing', { version: view.logLabel ?? '' })
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
            ];
          }
          if (view.phase === 'error') {
            return [
              notice('error', h(WarnIcon, { size: 15 }), t('update.errorTitle'), view.error ?? t('update.unknown')),
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
            }, view.choices.map((choice) => h('button', {
              key: choice.key,
              type: 'button',
              role: 'option',
              className: 'dsh-powerup-update-option',
              'aria-selected': choice.key === view.registryKey ? 'true' : 'false',
              onClick: () => chooseRegistry(choice.key),
            },
            h('span', { className: 'dsh-powerup-update-option-copy' },
              h('span', { className: 'dsh-powerup-update-option-title' }, choice.label),
              h('span', { className: 'dsh-powerup-update-option-host' }, choice.hint),
            ),
            choice.key === view.registryKey ? h('span', { className: 'dsh-powerup-update-check' }, h(CheckIcon, { size: 13 })) : null,
            )))
            : null,
        );
      }

      function buildRowItems(row, snapshot, t, sessionId, ctx, notify) {
        const text = rowText(row);
        const forkSeq = resolveForkSeq(row, snapshot);
        const quote = markdownQuote(row, t);
        const hasText = text !== '';
        const hasSession = typeof sessionId === 'string' && sessionId !== '';
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
          { id: 'export', icon: ExportIcon, name: t('action.export'), hint: t('action.exportHint') },
        ];
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
                h('div', { className: 'dsh-powerup-card-icon' }, h(UpdateIcon, { size: 18 })),
                h('div', { className: 'dsh-powerup-card-copy' },
                  h('h2', null, t('page.updateTitle')),
                  h('p', null, t('page.updateDesc')),
                ),
              ),
              h('p', { className: 'dsh-powerup-update-note', style: { marginTop: '12px' } }, t('page.updateHow')),
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
      }

      return {
        inject: ['slots', 'locale'],
        apply,
        // Exported for smoke tests only; the host never reads this.
        __test: {
          DICT,
          CSS,
          PowerUpLineIcon,
          UpdateIcon,
          PowerUpBridge,
          PowerUpPage,
          PowerUpOverlay,
          PluginUpdateOverlay,
          ensureUpdateButtons,
          updateButtonLabel,
          popoverPlacement,
          rowKeyParts,
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
          lookupRegistries,
          fetchRegistryVersions,
          registryHost,
          normalizeRegistry,
          readRememberedRegistry,
          packageDisplayTitle,
          normalizeVersionInput,
          inspectReason,
          operationReason,
        },
      };
    },
  });
})();
