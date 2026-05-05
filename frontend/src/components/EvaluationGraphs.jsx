import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = {
  PASS: '#22c55e', // green
  FAIL: '#ef4444', // red
  REVIEW: '#eab308' // yellow
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #ccc', padding: '8px 12px', borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <p style={{ margin: 0, fontWeight: 600, color: payload[0].payload.color }}>
          {payload[0].name}: {payload[0].value} Criteria
        </p>
      </div>
    );
  }
  return null;
};

export default function EvaluationGraphs({ evals }) {
  if (!evals || evals.length === 0) return null;

  // Group by verdict
  const passCount = evals.filter(e => e.result === 'PASS').length;
  const failCount = evals.filter(e => e.result === 'FAIL').length;
  const reviewCount = evals.filter(e => e.result === 'REVIEW').length;

  const pieData = [
    { name: 'Compliant (Pass)', value: passCount, color: COLORS.PASS },
    { name: 'Non-Compliant (Fail)', value: failCount, color: COLORS.FAIL },
    { name: 'Manual Review', value: reviewCount, color: COLORS.REVIEW }
  ].filter(d => d.value > 0);

  // Calculate Compliance Score
  const total = evals.length;
  const score = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>📊 Compliance Visualization</h3>
      </div>
      <div style={{ padding: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        
        {/* Compliance Donut */}
        <div style={{ flex: '1 1 300px', minWidth: 300, height: 250, position: 'relative' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
          {/* Center Text */}
          <div style={{ 
            position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%, -50%)', 
            textAlign: 'center', pointerEvents: 'none' 
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>{score}%</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score</div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
          <div style={{ background: 'var(--pass-bg)', padding: '12px 16px', borderRadius: 8, borderLeft: `4px solid ${COLORS.PASS}` }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: COLORS.PASS }}>Passed Criteria</h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bidder successfully meets {passCount} requirement(s).</p>
          </div>
          
          <div style={{ background: 'var(--fail-bg)', padding: '12px 16px', borderRadius: 8, borderLeft: `4px solid ${COLORS.FAIL}` }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: COLORS.FAIL }}>Failed Criteria</h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bidder explicitly failed {failCount} requirement(s).</p>
          </div>

          <div style={{ background: '#fefce8', padding: '12px 16px', borderRadius: 8, borderLeft: `4px solid ${COLORS.REVIEW}` }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: COLORS.REVIEW }}>Review Required</h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{reviewCount} requirement(s) need human verification.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
