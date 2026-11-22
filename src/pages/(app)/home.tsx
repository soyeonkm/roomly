/**
 * /home — signed-in users go straight to their rooms; signed-out visitors
 * get a sign-in prompt inside the app chrome.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AuthOverlay, useAuthStatus } from 'deepspace'
import { Button } from '@/components/ui'

export default function HomePage() {
  const { isSignedIn } = useAuthStatus()
  const [open, setOpen] = useState(false)
  if (isSignedIn) return <Navigate to="/rooms" replace />
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-4xl text-foreground">Welcome to Roomly</h1>
      <p className="max-w-md text-muted-foreground">Sign in to plan rooms and share them with your roommate.</p>
      <Button onClick={() => setOpen(true)}>Sign in</Button>
      {open && <AuthOverlay onClose={() => setOpen(false)} />}
    </div>
  )
}
