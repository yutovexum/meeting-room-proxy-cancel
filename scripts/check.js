// 動作確認スクリプト
// 起動直後のサーバーに、決まった順番でリクエストを送り、期待どおりの結果かを判定する。
// 前のケースのキャンセル結果が次のケースに影響するので、必ず起動し直してから実行する。
//
// 使い方:
//   node scripts/check.js 4000           … 通常の確認（全ケース）
//   node scripts/check.js 4000 retired   … 退職済みの管理者（id 4）がどう扱われるかを見る

const port = process.argv[2] || 3000;
const mode = process.argv[3] || 'all';
const base = `http://localhost:${port}`;

const MSG = {
  notFound: '対象の予約が見つかりません。',
  forbidden: '代理キャンセルの権限がありません。',
  reasonRequired: '代理キャンセルの理由を入力してください。',
  reasonTooLong: '理由は200文字以内で入力してください。',
  notCancelable: 'この予約はキャンセルできる状態ではありません。',
  success: 'キャンセルしました。',
};

async function cancel(id, body) {
  const res = await fetch(`${base}/reservations/${encodeURIComponent(id)}/cancel-by-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function list() {
  const res = await fetch(`${base}/cancellations`);
  return { status: res.status, body: await res.json() };
}

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : `\n      ${detail}`}`);
}

async function expectCancel(name, id, body, status, message) {
  const r = await cancel(id, body);
  // 文言は句点まで含めて完全に一致するかを見る
  const ok = r.status === status && r.text === message;
  record(name, ok, `期待: ${status} ${message} ／ 実際: ${r.status} ${r.text}`);
}

async function main() {
  if (mode === 'retired') {
    const r = await cancel(1, { executorId: 4, reason: 'retired admin check' });
    console.log(`退職済みの管理者（id 4）で予約1を代理キャンセル → ${r.status} ${r.text}`);
    return;
  }

  const reason = 'facility check';

  console.log('--- 判定1〜5（1つの条件だけに当てはまる場合） ---');
  await expectCancel('判定1: 存在しない予約999', 999, { executorId: 3, reason }, 404, MSG.notFound);
  await expectCancel('判定2: MEMBER（社員1）が実行', 1, { executorId: 1, reason }, 403, MSG.forbidden);
  await expectCancel('判定2: 存在しない社員999が実行', 1, { executorId: 999, reason }, 403, MSG.forbidden);
  await expectCancel('判定3: 理由が空文字', 1, { executorId: 3, reason: '' }, 400, MSG.reasonRequired);
  await expectCancel('判定3: 理由が全角空白・タブ・改行だけ', 1, { executorId: 3, reason: ' 　\t\n' }, 400, MSG.reasonRequired);
  await expectCancel('判定3: 理由を送らない', 1, { executorId: 3 }, 400, MSG.reasonRequired);
  await expectCancel('判定4: 理由が201文字', 1, { executorId: 3, reason: 'あ'.repeat(201) }, 400, MSG.reasonTooLong);
  await expectCancel('判定5: IN_USE の予約4', 4, { executorId: 3, reason }, 409, MSG.notCancelable);
  await expectCancel('判定5: CANCELED の予約3', 3, { executorId: 3, reason }, 409, MSG.notCancelable);

  console.log('--- 判定の順序（複数の条件に当てはまる場合） ---');
  await expectCancel('予約なし＋MEMBER＋理由なし → 判定1', 999, { executorId: 1, reason: '' }, 404, MSG.notFound);
  await expectCancel('CANCELED＋MEMBER＋理由なし → 判定2', 3, { executorId: 1, reason: '' }, 403, MSG.forbidden);
  await expectCancel('CANCELED＋理由が空白だけ → 判定3', 3, { executorId: 3, reason: '   ' }, 400, MSG.reasonRequired);
  await expectCancel('IN_USE＋理由201文字 → 判定4', 4, { executorId: 3, reason: 'あ'.repeat(201) }, 400, MSG.reasonTooLong);

  console.log('--- ID の数値比較 ---');
  await expectCancel('数値にできない予約ID "abc"', 'abc', { executorId: 3, reason }, 404, MSG.notFound);

  console.log('--- 失敗したときにデータが変わっていないか ---');
  const before = await list();
  record('ここまでの失敗で cancellations が0件のまま', before.status === 200 && before.body.length === 0,
    `実際: ${before.status} ${JSON.stringify(before.body)}`);

  console.log('--- 成功 ---');
  await expectCancel('絵文字200個の理由で予約1をキャンセル（length では400）', 1, { executorId: 3, reason: '😀'.repeat(200) }, 200, MSG.success);
  await expectCancel('予約ID・実行者IDを文字列で送り、前後の空白＋200文字の理由で予約2をキャンセル', '2', { executorId: '3', reason: '  ' + 'あ'.repeat(200) + '  ' }, 200, MSG.success);

  console.log('--- 2回目のキャンセル ---');
  await expectCancel('キャンセル済みの予約1をもう一度キャンセル', 1, { executorId: 3, reason }, 409, MSG.notCancelable);

  console.log('--- キャンセル記録の一覧 ---');
  const after = await list();
  const [c1, c2] = after.body;
  record('GET /cancellations が200で2件', after.status === 200 && after.body.length === 2,
    `実際: ${after.status} ${after.body.length}件`);
  record('1件目: 予約1・実行者3・is_proxy true・実行日時あり',
    c1 && c1.reservation_id === 1 && c1.canceled_by === 3 && c1.is_proxy === true && !Number.isNaN(Date.parse(c1.canceled_at)),
    `実際: ${JSON.stringify(c1)}`);
  record('2件目: 予約2・実行者3（数値）・理由は前後の空白を除いた200文字',
    c2 && c2.reservation_id === 2 && c2.canceled_by === 3 && c2.reason === 'あ'.repeat(200),
    `実際: reservation_id=${c2 && c2.reservation_id} canceled_by=${c2 && c2.canceled_by} reason の長さ=${c2 && c2.reason.length}`);

  const ng = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length}件中 ${results.length - ng}件 OK、${ng}件 NG`);
  process.exitCode = ng === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('サーバーに接続できませんでした。先に npm start で起動してください。', e.message);
  process.exitCode = 1;
});
