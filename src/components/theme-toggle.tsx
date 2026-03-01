"use client"

import * as React from "react"
import { useTheme } from "next-themes"

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return (
            <button className="btn btn-ghost btn-sm btn-square">
                <i className="iconoir-sun-light text-[20px]" aria-hidden="true" />
                <span className="sr-only">Toggle theme</span>
            </button>
        )
    }

    const toggleTheme = () => {
        if (theme === 'system') setTheme('light')
        else if (theme === 'light') setTheme('dark')
        else setTheme('system')
    }

    return (
        <button className="btn btn-ghost btn-sm btn-square" onClick={toggleTheme} title={`Current theme: ${theme}`}>
            {theme === 'system' && <i className="iconoir-computer text-[20px]" aria-hidden="true" />}
            {theme === 'light' && <i className="iconoir-sun-light text-[20px]" aria-hidden="true" />}
            {theme === 'dark' && <i className="iconoir-moon-sat text-[20px]" aria-hidden="true" />}
            <span className="sr-only">Toggle theme</span>
        </button>
    )
}
