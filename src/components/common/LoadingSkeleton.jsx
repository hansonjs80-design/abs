import React from 'react';

/**
 * 데이터 그리드용 스켈레톤 로딩 컴포넌트
 */
export function GridSkeleton({ rows = 12, cols = 8 }) {
  return (
    <div className="loading-skeleton-grid" aria-label="데이터 로딩 중" role="status">
      {/* 헤더 스켈레톤 */}
      <div className="skeleton-header-bar">
        <div className="skeleton skeleton-title" style={{ width: '200px', height: '32px' }} />
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <div className="skeleton skeleton-badge" style={{ width: '80px', height: '24px', borderRadius: '999px' }} />
          <div className="skeleton skeleton-badge" style={{ width: '80px', height: '24px', borderRadius: '999px' }} />
        </div>
      </div>
      {/* 테이블 스켈레톤 */}
      <div className="skeleton-table">
        <div className="skeleton-table-header">
          {Array.from({ length: cols }, (_, i) => (
            <div key={i} className="skeleton skeleton-cell-header" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, ri) => (
          <div key={ri} className="skeleton-table-row" style={{ animationDelay: `${ri * 40}ms` }}>
            {Array.from({ length: cols }, (_, ci) => (
              <div key={ci} className="skeleton skeleton-cell" style={{ animationDelay: `${(ri * cols + ci) * 15}ms` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 결산 카드용 스켈레톤
 */
export function SettlementSkeleton() {
  return (
    <div className="loading-skeleton-settlement" aria-label="결산 데이터 로딩 중" role="status">
      <div className="skeleton-card">
        <div className="skeleton skeleton-card-title" style={{ width: '180px', height: '28px', marginBottom: '16px' }} />
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div className="skeleton" style={{ width: '100px', height: '20px', borderRadius: '999px' }} />
          <div className="skeleton" style={{ width: '120px', height: '20px', borderRadius: '999px' }} />
          <div className="skeleton" style={{ width: '90px', height: '20px', borderRadius: '999px' }} />
        </div>
        <div className="skeleton-settlement-table">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton-settlement-row" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="skeleton" style={{ width: '60px', height: '18px' }} />
              <div className="skeleton" style={{ flex: 1, height: '18px' }} />
              <div className="skeleton" style={{ width: '80px', height: '18px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 인라인 로딩 표시자 (작은 영역)
 */
export function InlineLoader({ text = '로딩 중...' }) {
  return (
    <div className="inline-loader" role="status">
      <div className="inline-loader-spinner" />
      <span>{text}</span>
    </div>
  );
}

/**
 * 탭 전환 시 페이드 전환 래퍼
 */
export function FadeTransition({ children, show = true }) {
  if (!show) return null;
  return (
    <div className="fade-transition-wrapper">
      {children}
    </div>
  );
}
