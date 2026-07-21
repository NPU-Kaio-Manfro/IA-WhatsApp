const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysPending(lastClientMsgAtIso, nowIso) {
  const diffMs = new Date(nowIso).getTime() - new Date(lastClientMsgAtIso).getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

function parseThresholds(thresholdsCsv) {
  const values = thresholdsCsv.split(',').map((s) => parseInt(s.trim(), 10));

  if (values.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(
      `Invalid SLA_THRESHOLDS value: "${thresholdsCsv}" contains a non-numeric or non-positive entry`,
    );
  }

  return values.sort((a, b) => a - b);
}

function buildRanges(thresholds) {
  return thresholds.map((min, i) => {
    const isLast = i === thresholds.length - 1;
    const max = isLast ? Infinity : thresholds[i + 1] - 1;
    const label = isLast ? `${min}+ dias` : `${min}-${max} dias`;
    return { label, min, max };
  });
}

function classifyPending(pendingContacts, thresholds, nowIso) {
  const ranges = buildRanges(thresholds);

  return ranges.map((range) => {
    const contacts = pendingContacts
      .map((row) => ({
        chatId: row.chat_id,
        contactName: row.contact_name,
        isGroup: !!row.is_group,
        days: daysPending(row.last_client_msg_at, nowIso),
      }))
      .filter((c) => c.days >= range.min && c.days <= range.max)
      .sort((a, b) => b.days - a.days);

    return { ...range, contacts };
  });
}

module.exports = { daysPending, parseThresholds, buildRanges, classifyPending };
