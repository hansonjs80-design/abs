import ShockwaveView from '../components/shockwave/ShockwaveView';

export default function Shockwave2Page() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">충격파 스케줄 (2인)</h1>
      </div>
      <ShockwaveView type="2인" />
    </div>
  );
}
