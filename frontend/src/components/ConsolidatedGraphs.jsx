import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = {
  PASS: '#22c55e',
  FAIL: '#ef4444',
  REVIEW: '#eab308'
};

const VERDICT_COLORS = {
  ELIGIBLE: '#22c55e',
  NOT_ELIGIBLE: '#ef4444',
  REVIEW_REQUIRED: '#eab308'
};

const CustomBarTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px 14px', borderRadius: 6, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 700, borderBottom: '1px solid #eee', paddingBottom: 6 }}>{label}</p>
        {payload.map(p => (
          <p key={p.dataKey} style={{ margin: '4px 0', color: p.color, fontSize: '0.85rem', fontWeight: 600 }}>
            {p.name}: {p.value} Criteria
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ConsolidatedGraphs({ report }) {
  if (!report || !report.bidder_results || report.bidder_results.length === 0) return null;

  // 1. Data for Bar Chart: Criteria Performance per Bidder
  const barData = report.bidder_results.map(b => ({
    name: b.bidder_name.length > 15 ? b.bidder_name.substring(0, 15) + '...' : b.bidder_name,
    PASS: b.pass_count || 0,
    FAIL: b.fail_count || 0,
    REVIEW: b.review_count || 0,
    total: (b.pass_count || 0) + (b.fail_count || 0) + (b.review_count || 0)
  }));

  // 2. Data for Pie Chart: Overall Verdicts
  const verdictCounts = report.bidder_results.reduce((acc, b) => {
    acc[b.verdict] = (acc[b.verdict] || 0) + 1;
    return acc;
  }, {});

  const pieData = [
    { name: 'Eligible', value: verdictCounts['ELIGIBLE'] || 0, color: VERDICT_COLORS.ELIGIBLE },
    { name: 'Not Eligible', value: verdictCounts['NOT_ELIGIBLE'] || 0, color: VERDICT_COLORS.NOT_ELIGIBLE },
    { name: 'Review Required', value: verdictCounts['REVIEW_REQUIRED'] || 0, color: VERDICT_COLORS.REVIEW_REQUIRED }
  ].filter(d => d.value > 0);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>📊 Comparative Analytics</h3>
      </div>
      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        
        {/* Bar Chart: Criteria by Bidder */}
        <div style={{ flex: '2 1 500px', minWidth: 400, height: 350 }}>
          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, textAlign: 'center' }}>Criteria Performance per Bidder</h4>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: '#f1f5f9' }} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '0.85rem' }}/>
              <Bar dataKey="PASS" name="Passed" stackId="a" fill={COLORS.PASS} radius={[0, 0, 4, 4]} maxBarSize={60} />
              <Bar dataKey="REVIEW" name="Review Req." stackId="a" fill={COLORS.REVIEW} maxBarSize={60} />
              <Bar dataKey="FAIL" name="Failed" stackId="a" fill={COLORS.FAIL} radius={[4, 4, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart: Overall Verdicts */}
        <div style={{ flex: '1 1 300px', minWidth: 300, height: 350, display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, textAlign: 'center' }}>Overall Bidder Outcomes</h4>
          <div style={{ flex: 1, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value, name) => [`${value} Bidder(s)`, name]}
                  contentStyle={{ borderRadius: 6, border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '0.85rem' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
