'use client'

import { UserButton } from "@clerk/nextjs"
import { Id } from "../../../../convex/_generated/dataModel"

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import Link from "next/link"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import { useState } from "react"
import { useDemoReName } from "../demo-hooks/use-demo-project"

export function DemoNavbar({
    demoProjectId
}: {
    demoProjectId: Id<'projects'>
}) {

    const project = useQuery(api.projects.getById, { id: demoProjectId })
    const renameProject = useDemoReName(demoProjectId)

    const [isRenaming, setIsRenaming] = useState(false);
    const [name, setName] = useState("");

    const handleClick = () => {
        if (!project) return

        setIsRenaming(true)
        setName(project?.name)
    }

    const handleSubmit = () => {
        if (!project) return
        setIsRenaming(false)

        const trimmedName = name.trim()

        renameProject({ id: demoProjectId, name: trimmedName })
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmit()
        } else if (e.key === 'Escape') {
            setIsRenaming(false)
        }
    }

    return (
        <nav
            className="bg-pink-400 flex justify-between items-center p-2"
        >
            <div className="flex">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href='/'>
                                    <span>Polaris</span>
                                </Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        {isRenaming
                            ? (
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    onBlur={handleSubmit}
                                    onKeyDown={handleKeyDown}
                                    className=""
                                />
                            )
                            : (
                                <BreadcrumbItem>
                                    <BreadcrumbPage
                                        onClick={handleClick}
                                    >
                                        {project?.name ?? 'loading...'}
                                    </BreadcrumbPage>
                                </BreadcrumbItem>
                            )}

                    </BreadcrumbList>
                </Breadcrumb>

            </div>

            <div>
                <UserButton />
            </div>
        </nav>
    )
}