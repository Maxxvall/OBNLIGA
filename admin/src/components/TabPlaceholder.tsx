import { ReactNode } from 'react'

interface TabPlaceholderProps {
  title: string
  description: string
  children?: ReactNode
}

export const TabPlaceholder = ({ title, description, children }: TabPlaceholderProps) => (
  <div className="placeholder-card">
    <h3>{title}</h3>
    <p>{description}</p>
    {children ?? null}
  </div>
)
