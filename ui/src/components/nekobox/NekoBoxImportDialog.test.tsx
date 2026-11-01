// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxImportDialog.test.tsx — диалог переноса из NekoBox (T-78): путь и
// «Выбрать папку…», предпросмотр перед переносом, предупреждение «закройте
// NekoBox», отчёт с причинами пропусков, ошибка переноса, «Сделать активным».
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../../lib/i18n';
import { Failure, flush, mount, stubCore, unmountAll, type CoreStub } from '../../test-utils/coreStub';
import { NekoBoxImportDialog } from './NekoBoxImportDialog';

const pickFolderMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('../../lib/pickFolder', () => ({ pickFolder: pickFolderMock, canPickFolder: (): boolean => true }));

const CANDIDATES = {
  candidates: [
    { path: 'C:/neko/config', source: 'process', groups: 2, profiles: 32, routes: 3, looksRunning: true },
    { path: 'C:/old/config', source: 'appdata', groups: 1, profiles: 4, routes: 0 },
  ],
};

const REPORT = {
  groupsImported: 2,
  profilesByType: { vless: 3, trojan: 1 },
  alreadyPresent: 1,
  renumbered: 2,
  skipped: [{ file: 'profiles/9.json', id: '9', type: 'wireguard', reason: 'unknown profile type "wireguard"' }],
  warnings: ['group "Sub": front_proxy_id 7 references missing profile; dropped'],
  routesFound: 2,
  routesImported: 2,
  settingsImported: ['inbound.port'],
  nekoboxActiveRoute: 'custom:neko-ru-bypass',
};

let stub: CoreStub;
const onClose = vi.fn();
const onImported = vi.fn();

const dlg = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (el === null) throw new Error('диалог не открыт');
  return el;
};
const button = (label: string): HTMLButtonElement => {
  const b = Array.from(dlg().querySelectorAll<HTMLButtonElement>('button')).find((x) => (x.textContent ?? '').trim() === label);
  if (b === undefined) throw new Error(`кнопки «${label}» нет`);
  return b;
};
const input = (): HTMLInputElement => {
  const el = dlg().querySelector<HTMLInputElement>('#nbPath');
  if (el === null) throw new Error('поля пути нет');
  return el;
};

async function press(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
    await Promise.resolve();
  });
  await flush(20);
}

function typePath(value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function open(routes: Parameters<typeof stubCore>[0] = {}): Promise<void> {
  stub = stubCore({
    'MigrationService/DetectNekoBox': CANDIDATES,
    'MigrationService/PreviewNekoBoxImport': { ...REPORT, dryRun: true },
    'MigrationService/ImportNekoBox': REPORT,
    'RoutingService/ActivatePreset': {},
    ...routes,
  });
  await mount(createElement(NekoBoxImportDialog, { onClose, onImported }));
}

beforeEach(() => {
  setLanguage('en');
  onClose.mockReset();
  onImported.mockReset();
  pickFolderMock.mockReset();
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('NekoBoxImportDialog (T-78)', () => {
  it('pick_folder_fills_path: «Выбрать папку…» подставляет путь из диалога оболочки', async () => {
    pickFolderMock.mockResolvedValue('D:/Soft/nekoray/config');
    await open();
    await press(t('nb.pick'));
    expect(input().value).toBe('D:/Soft/nekoray/config');
  });

  it('отмена выбора папки ничего не меняет, сбой показывает ошибку', async () => {
    await open();
    typePath('C:/x');
    pickFolderMock.mockResolvedValueOnce(null);
    await press(t('nb.pick'));
    expect(input().value).toBe('C:/x');
    pickFolderMock.mockRejectedValueOnce(new Error('join error'));
    await press(t('nb.pick'));
    expect(dlg().querySelector('[role="alert"]')?.textContent).toBe(t('nb.err.pick'));
  });

  it('preview_before_import: «Перенести» доступна только после предпросмотра этих же данных', async () => {
    await open();
    expect(button(t('nb.import')).disabled).toBe(true);
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    expect(stub.bodies('MigrationService/PreviewNekoBoxImport')).toEqual([
      { path: 'C:/neko/config', includeRoutes: true },
    ]);
    expect(dlg().textContent).toContain('Will be imported: 4 servers, 2 groups, 2 routes');
    expect(stub.bodies('MigrationService/ImportNekoBox')).toHaveLength(0);
    expect(button(t('nb.import')).disabled).toBe(false);

    typePath('C:/other/config'); // правка пути обесценивает предпросмотр
    expect(button(t('nb.import')).disabled).toBe(true);
    expect(dlg().textContent).not.toContain('Will be imported');

    await press(t('nb.preview'));
    await press(t('nb.import'));
    expect(stub.bodies('MigrationService/ImportNekoBox')).toEqual([{ path: 'C:/other/config', includeRoutes: true }]);
    expect(dlg().textContent).toContain('Imported: 4 servers, 2 groups, 2 routes');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('галочки уходят в запрос', async () => {
    await open();
    typePath('C:/neko/config');
    act(() => {
      dlg().querySelector<HTMLInputElement>('#nbSettings')?.click();
      dlg().querySelector<HTMLInputElement>('#nbRoutes')?.click();
    });
    await press(t('nb.preview'));
    expect(stub.bodies('MigrationService/PreviewNekoBoxImport')).toEqual([
      { path: 'C:/neko/config', includeSettings: true },
    ]);
  });

  it('close_nekobox_warning: у запущенного NekoBox — предупреждение, у остальных нет', async () => {
    await open();
    expect(dlg().querySelector('[role="alert"]')).toBeNull();
    const [running, idle] = Array.from(dlg().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    act(() => {
      running?.click();
    });
    expect(input().value).toBe('C:/neko/config');
    expect(dlg().querySelector('[role="alert"]')?.textContent).toBe(t('nb.closeWarn'));
    act(() => {
      idle?.click();
    });
    expect(input().value).toBe('C:/old/config');
    expect(dlg().querySelector('[role="alert"]')).toBeNull();
  });

  it('найденные установки показаны с источником и числами', async () => {
    await open();
    const text = dlg().textContent ?? '';
    expect(text).toContain('C:/neko/config');
    expect(text).toContain(t('nb.source.process'));
    expect(text).toContain('32 servers, 2 groups, 3 routes');
    expect(dlg().querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(t('nb.found'));
  });

  it('без найденного — подсказка вводить путь вручную', async () => {
    await open({ 'MigrationService/DetectNekoBox': { candidates: [] } });
    expect(dlg().textContent).toContain(t('nb.none'));
  });

  it('neko_report_lists_skipped: отчёт называет файл и причину каждого пропуска', async () => {
    await open();
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    await press(t('nb.import'));
    const region = dlg().querySelector('.nb-report');
    expect(region?.textContent).toContain('profiles/9.json');
    expect(region?.textContent).toContain('unknown profile type "wireguard"');
    expect(region?.textContent).toContain('Not imported (1)');
    expect(region?.textContent).toContain('front_proxy_id 7 references missing profile');
    expect(region?.textContent).toContain('Already imported earlier: 1');
    expect(region?.textContent).toContain('Renumbered because the number was already taken: 2');
  });

  it('import_error_shown: ошибка переноса видна, предпросмотр остаётся, повтор возможен', async () => {
    await open({ 'MigrationService/ImportNekoBox': new Failure('aborted', 'busy') });
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    await press(t('nb.import'));
    expect(dlg().querySelector('[role="alert"]')?.textContent).toBe(t('nb.err.busy'));
    expect(onImported).not.toHaveBeenCalled();
    expect(button(t('nb.import')).disabled).toBe(false);
  });

  it('ошибки ядра по кодам: нет папки, не config NekoBox, лимиты', async () => {
    const cases: [string, string][] = [
      ['not_found', t('nb.err.notFound')],
      ['invalid_argument', t('nb.err.invalid')],
      ['resource_exhausted', t('nb.err.limits')],
    ];
    for (const [code, text] of cases) {
      await open({ 'MigrationService/PreviewNekoBoxImport': new Failure(code, 'x') });
      typePath('C:/x');
      await press(t('nb.preview'));
      expect(dlg().querySelector('[role="alert"]')?.textContent, code).toBe(text);
      unmountAll();
      document.body.innerHTML = '';
    }
  });

  it('пустой путь не уходит в ядро', async () => {
    await open();
    await press(t('nb.preview'));
    expect(dlg().querySelector('[role="alert"]')?.textContent).toBe(t('nb.err.empty'));
    expect(stub.bodies('MigrationService/PreviewNekoBoxImport')).toHaveLength(0);
  });

  it('«Включить маршрут из NekoBox» активирует набор из отчёта', async () => {
    await open();
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    await press(t('nb.import'));
    await press(t('nb.activate'));
    expect(stub.bodies('RoutingService/ActivatePreset')).toEqual([{ id: 'custom:neko-ru-bypass' }]);
    expect(dlg().textContent).toContain(t('nb.activated'));
    await press(t('nb.done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onImported получает отчёт; подсказка о перезапуске — только при настройках, которым он нужен', async () => {
    await open({
      'SettingsService/DescribeSettings': {
        descriptors: [
          { key: 'inbound.port', requiresProfileRestart: true },
          { key: 'ui.theme', requiresAppRestart: false },
        ],
      },
    });
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    await press(t('nb.import'));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(dlg().textContent).toContain(t('nb.restartProfile'));
    expect(dlg().textContent).not.toContain(t('nb.restartApp'));
  });

  it('без перенесённых настроек подсказки нет и описания настроек не запрашиваются', async () => {
    await open({ 'MigrationService/ImportNekoBox': { ...REPORT, settingsImported: [] } });
    typePath('C:/neko/config');
    await press(t('nb.preview'));
    await press(t('nb.import'));
    expect(dlg().textContent).not.toContain(t('nb.restartProfile'));
    expect(stub.bodies('SettingsService/DescribeSettings')).toHaveLength(0);
  });

  it('a11y: диалог подписан заголовком, поле пути — меткой и подсказкой', async () => {
    await open();
    expect(dlg().getAttribute('aria-labelledby')).toBe('nbTitle');
    expect(document.querySelector('#nbTitle')?.textContent).toBe(t('nb.title'));
    expect(dlg().querySelector('label[for="nbPath"]')?.textContent).toBe(t('nb.path'));
    expect(input().getAttribute('aria-describedby')).toBe('nbPathHint');
  });
});
