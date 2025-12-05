import React from 'react'
import './ProfileCardModal.css'

const blocks = [
  { width: '60%', height: 14 },
  { width: '48%', height: 12 },
  { width: '36%', height: 12 },
]

export function ProfileCardSkeleton() {
  return (
    <div className="profile-card-skeleton">
      <div className="profile-card-skeleton-line" style={{ width: '70%', height: 14 }} />
      <div className="profile-card-skeleton-line" style={{ width: '55%', height: 12 }} />
      <div className="profile-card-skeleton-divider" />
      <div className="profile-card-skeleton-row">
        {blocks.map((block, index) => (
          <div
            key={index}
            className="profile-card-skeleton-pill"
            style={{ width: block.width, height: block.height }}
          />
        ))}
      </div>
    </div>
  )
}

export default ProfileCardSkeleton
