import { Id } from "../../../../convex/_generated/dataModel"
import { DemoNavbar } from "../demo-components/demo-navbar"

export function DemoProjectsView({
    children,
    demoProjectId,
}: {
    children: React.ReactNode,
    demoProjectId: Id<'projects'>
}) {
    return (
        <div className="w-full h-screen flex flex-col">
            <DemoNavbar demoProjectId={demoProjectId} />

            <div>DemoProjectsView</div>
        </div>
    )
}