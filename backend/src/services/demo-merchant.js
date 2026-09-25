'use strict';

// A card processor, for the demo shop only.
//
// Batch reconciliation is the feature hardest to show and the easiest to
// explain: here is what the register rang up, here is what the bank actually
// settled, and here is every day the two disagree. Showing it normally means
// connecting a real merchant account, which nobody evaluating the product is
// going to do.
//
// So the demo gets a processor of its own. It reads the demo's real card
// sales and returns what a processor would have settled against them —
// mostly matching, because most days do, with four disagreements built in on
// purpose. Each one is a thing that actually happens to shops, and each looks
// different on the report:
//
//   settled late      the batch cut after midnight, so the money lands on the
//                     next day's statement. Two days both look wrong; together
//                     they are right, and that is the point.
//   never funded      a sale the register took and the processor has no record
//                     of. Real money, missing, and the only way anyone finds
//                     out is a report like this one.
//   not in the till   the processor charged a card that no sale was rung up
//                     for — a manual keyed payment, usually, or a till nobody
//                     closed properly.
//   declined          authorised, then failed to settle. The register thinks
//                     it sold something; the bank disagrees.
//
// Deterministic, so the demo reads the same on Tuesday as it did on Monday,
// and derived from whatever the seed actually generated rather than hardcoded
// figures that would drift away from it.

// Which days get which scenario. Counted back from the most recent day with
// card sales, so they always fall inside whatever range is being looked at.
const SCENARIOS = {
  SETTLED_LATE: 3,     // the 3rd most recent trading day
  NEVER_FUNDED: 6,
  NOT_IN_TILL: 9,
  DECLINED: 12,
};

const round2 = (n) => Math.round(n * 100) / 100;

// Stable pseudo-randomness from a date string, so the same day always gets the
// same figures however many times the report is run.
function jitter(dateStr, salt) {
  let h = 0;
  const s = dateStr + salt;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return (h % 1000) / 1000;
}

/**
 * What the processor settled, by date, against the shop's own card sales.
 *
 * @param {Array<{date: string, net_total: number, sale_count: number}>} posDays
 * @returns {Object} merchantByDate, in the shape the audit route expects
 */
function settlementFor(posDays) {
  const byDate = {};
  const days = [...posDays].filter((d) => Number(d.net_total) > 0).sort((a, b) => (a.date < b.date ? 1 : -1));

  const dayAt = (n) => days[n]?.date || null;
  const lateDay = dayAt(SCENARIOS.SETTLED_LATE);
  const unfundedDay = dayAt(SCENARIOS.NEVER_FUNDED);
  const extraDay = dayAt(SCENARIOS.NOT_IN_TILL);
  const declinedDay = dayAt(SCENARIOS.DECLINED);

  const put = (date, fields) => {
    if (!date) return;
    const row = byDate[date] || {
      total: 0, sales: 0, credits: 0, sale_count: 0, credit_count: 0,
      failed: 0, failed_amount: 0, over_limit: 0, over_limit_amount: 0,
      batchIds: new Set(), txns: 0,
    };
    row.total = round2(row.total + (fields.total || 0));
    row.sales = round2(row.sales + (fields.sales || 0));
    row.credits = round2(row.credits + (fields.credits || 0));
    row.sale_count += fields.sale_count || 0;
    row.credit_count += fields.credit_count || 0;
    row.failed += fields.failed || 0;
    row.failed_amount = round2(row.failed_amount + (fields.failed_amount || 0));
    row.txns += fields.txns || 0;
    if (fields.batch) row.batchIds.add(fields.batch);
    byDate[date] = row;
  };

  // The day after a given one, for a batch that cut late.
  const nextDay = (date) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  for (const day of days) {
    const total = round2(Number(day.net_total));
    const count = Number(day.sale_count) || 1;
    const batch = `DEMO-${day.date.replace(/-/g, '')}`;

    if (day.date === lateDay) {
      // The batch cut after midnight. Part settled on the day, the rest landed
      // on the next — so both days look wrong and the pair is right.
      const onTime = round2(total * (0.35 + jitter(day.date, 'late') * 0.2));
      put(day.date, { total: onTime, sales: onTime, sale_count: Math.max(1, Math.round(count * 0.4)), batch, txns: count });
      put(nextDay(day.date), {
        total: round2(total - onTime), sales: round2(total - onTime),
        sale_count: count - Math.max(1, Math.round(count * 0.4)),
        batch: batch + '-LATE', txns: count,
      });
      continue;
    }

    if (day.date === unfundedDay) {
      // One sale the register took that the processor never funded.
      const missing = round2(total * (0.18 + jitter(day.date, 'gap') * 0.12));
      put(day.date, { total: round2(total - missing), sales: round2(total - missing),
        sale_count: Math.max(1, count - 1), batch, txns: count - 1 });
      continue;
    }

    if (day.date === declinedDay) {
      // Authorised at the till, declined at settlement.
      const declined = round2(total * (0.12 + jitter(day.date, 'dec') * 0.1));
      put(day.date, {
        total: round2(total - declined), sales: round2(total - declined),
        sale_count: Math.max(1, count - 1), batch, txns: count,
        failed: 1, failed_amount: declined,
      });
      continue;
    }

    put(day.date, { total, sales: total, sale_count: count, batch, txns: count });
  }

  if (extraDay) {
    // A card charged with nothing rung up against it.
    const stray = round2(120 + jitter(extraDay, 'stray') * 380);
    put(extraDay, { total: stray, sales: stray, sale_count: 1, batch: `DEMO-${extraDay.replace(/-/g, '')}-KEYED`, txns: 1 });
  }

  return byDate;
}

module.exports = { settlementFor };
