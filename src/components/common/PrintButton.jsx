import { Printer } from 'lucide-react';

export default function PrintButton() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <button
      className="print-toggle"
      type="button"
      onClick={handlePrint}
      aria-label="현재 화면 인쇄"
      title="현재 화면 인쇄"
    >
      <Printer size={20} />
    </button>
  );
}
