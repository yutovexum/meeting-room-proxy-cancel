const express = require('express');
const app = express();

app.use(express.json());

// --------------------------------------------------
// 初期データ構造（メモリ上保存）
// --------------------------------------------------
const users = [
  { id: 1, name: '山田 太郎', status: 'ACTIVE', role: 'MEMBER' },
  { id: 2, name: '佐藤 花子', status: 'ACTIVE', role: 'MEMBER' },
  { id: 3, name: '鈴木 一郎', status: 'ACTIVE', role: 'ADMIN' },
  { id: 4, name: '田中 次郎', status: 'RETIRED', role: 'ADMIN' }
];

const reservations = [
  { id: 1, room_id: 101, start_at: '2026-11-01T10:00:00Z', end_at: '2026-11-01T11:00:00Z', user_id: 1, status: 'BOOKED', created_at: '2026-10-20T00:00:00Z' },
  { id: 2, room_id: 102, start_at: '2026-11-01T13:00:00Z', end_at: '2026-11-01T14:00:00Z', user_id: 2, status: 'BOOKED', created_at: '2026-10-20T00:00:00Z' },
  { id: 3, room_id: 101, start_at: '2026-10-25T09:00:00Z', end_at: '2026-10-25T10:00:00Z', user_id: 1, status: 'CANCELED', created_at: '2026-10-19T00:00:00Z' },
  { id: 4, room_id: 103, start_at: '2026-10-20T10:00:00Z', end_at: '2026-10-20T11:00:00Z', user_id: 2, status: 'IN_USE', created_at: '2026-10-20T00:00:00Z' }
];

const cancellations = [];
let nextCancellationId = 1;

// --------------------------------------------------
// ヘルパー関数: Unicodeコードポイント単位で正確に文字数をカウント
// --------------------------------------------------
function getCharacterLength(str) {
  return Array.from(str).length;
}

// --------------------------------------------------
// API1: POST /reservations/:id/cancel-by-admin
// --------------------------------------------------
app.post('/reservations/:id/cancel-by-admin', (req, res) => {
  const receivedAt = new Date().toISOString();
  const rawReservationId = req.params.id;
  const reservationId = Number(rawReservationId);
  const { executorId: rawExecutorId, reason } = req.body || {};
  const executorId = Number(rawExecutorId);

  // 理由のトリミングと文字数計算
  const rawReasonStr = typeof reason === 'string' ? reason : '';
  const trimmedReason = rawReasonStr.trim();
  const reasonLength = getCharacterLength(trimmedReason);

  let statusCode = 200;
  let stopPoint = '';
  let responseMessage = '';
  let executor; // 判定と成功時処理の両方から参照できるよう外側で宣言

  // --------------------------------------------------
  // 順序厳密判定
  // --------------------------------------------------

  // 1. 予約IDが存在しない、または該当する予約が無い
  const reservation = reservations.find(r => r.id === reservationId);
  if (!reservation) {
    statusCode = 404;
    stopPoint = '判定1（対象予約なし）';
    responseMessage = '対象の予約が見つかりません。';
  } else {
    // 2. 実行者の role が ADMIN でない
    executor = users.find(u => u.id === executorId);
    if (!executor || executor.role !== 'ADMIN') {
      statusCode = 403;
      stopPoint = '判定2（権限なし）';
      responseMessage = '代理キャンセルの権限がありません。';
    } else if (reasonLength === 0) {
      // 3. 理由が未入力（空文字・空白のみを含む）
      statusCode = 400;
      stopPoint = '判定3（理由未入力）';
      responseMessage = '代理キャンセルの理由を入力してください。';
    } else if (reasonLength > 200) {
      // 4. 理由が200文字を超えている
      statusCode = 400;
      stopPoint = '判定4（理由200文字超過）';
      responseMessage = '理由は200文字以内で入力してください。';
    } else if (reservation.status !== 'BOOKED') {
      // 5. 予約の status が BOOKED でない
      statusCode = 409;
      stopPoint = '判定5（ステータス不正）';
      responseMessage = 'この予約はキャンセルできる状態ではありません。';
    }
  }

  // コンソールログ出力（要求3）
  console.log(`[REQUEST LOG] 日時: ${receivedAt} | 予約ID: ${rawReservationId} | 実行者ID: ${rawExecutorId} | 理由文字数: ${reasonLength}文字 | ステータス: ${statusCode} | 停止判定: ${stopPoint || '成功'}`);

  // エラー停止時のレスポンス処理
  if (statusCode !== 200) {
    return res.status(statusCode).send(responseMessage);
  }

  // --------------------------------------------------
  // 成功時の処理
  // --------------------------------------------------
  reservation.status = 'CANCELED';

  cancellations.push({
    id: nextCancellationId++,
    reservation_id: reservation.id,
    canceled_by: executor.id,
    canceled_at: new Date().toISOString(),
    is_proxy: true,
    reason: trimmedReason
  });

  return res.status(200).send('キャンセルしました。');
});

// --------------------------------------------------
// API2: GET /cancellations
// --------------------------------------------------
app.get('/cancellations', (req, res) => {
  const result = cancellations.map(c => ({
    reservation_id: c.reservation_id,
    canceled_by: c.canceled_by,
    canceled_at: c.canceled_at,
    is_proxy: c.is_proxy,
    reason: c.reason
  }));

  return res.status(200).json(result);
});

// --------------------------------------------------
// サーバー起動
// --------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
