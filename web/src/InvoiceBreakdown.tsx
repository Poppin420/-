import type { CalcResult } from "@core/invoicing/calc";
import { formatEuro } from "@core/intent-parsing/resolve";

/** Full fiscal breakdown as it will be sent: per line, per VAT rate, withholdings and totals. */
export function InvoiceBreakdown({ calc }: { calc: CalcResult }) {
  return (
    <div className="breakdown">
      <table>
        <thead>
          <tr>
            <th>Περιγραφή</th>
            <th>Ποσ.</th>
            <th>ΦΠΑ</th>
            <th>Καθαρή</th>
            <th>Ποσό ΦΠΑ</th>
            <th>Σύνολο</th>
          </tr>
        </thead>
        <tbody>
          {calc.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td>{l.quantity.replace(".", ",")}</td>
              <td>{l.vat_rate}%</td>
              <td>{formatEuro(l.net)}</td>
              <td>{formatEuro(l.vat)}</td>
              <td>{formatEuro(l.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="fields totals">
        {calc.by_rate.length > 1 &&
          calc.by_rate.map((r) => (
            <div className="row" key={r.vat_rate}>
              <dt>ΦΠΑ {r.vat_rate}%</dt>
              <dd>
                {formatEuro(r.vat)} επί {formatEuro(r.net)}
              </dd>
            </div>
          ))}
        <div className="row">
          <dt>Καθαρή αξία</dt>
          <dd>{formatEuro(calc.totals.net)}</dd>
        </div>
        <div className="row">
          <dt>ΦΠΑ</dt>
          <dd>{formatEuro(calc.totals.vat)}</dd>
        </div>
        <div className="row">
          <dt>Συνολική αξία</dt>
          <dd>
            <strong>{formatEuro(calc.totals.gross)}</strong>
          </dd>
        </div>
        {calc.withholdings.map((w) => (
          <div className="row" key={w.label}>
            <dt>
              {w.label} {w.rate}%
            </dt>
            <dd>−{formatEuro(w.amount)}</dd>
          </div>
        ))}
        {calc.withholdings.length > 0 && (
          <div className="row">
            <dt>Πληρωτέο</dt>
            <dd>
              <strong>{formatEuro(calc.totals.payable)}</strong>
            </dd>
          </div>
        )}
      </dl>
      <p className="note small-note">Υπολογισμός από το σύστημα, με τους κανόνες του προφίλ σας. Όχι από το LLM.</p>
    </div>
  );
}
