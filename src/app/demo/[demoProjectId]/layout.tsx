import { DemoProjectsView } from "@/demo/demo-projects/demo-views/demo-projects-view"
import { Id } from "../../../../convex/_generated/dataModel"

export default async function Layout({
    children,
    params
}: {
    children: React.ReactNode,
    params: Promise<{ demoProjectId: Id<'projects'> }>
}) {

    const { demoProjectId } = await params

    return (
        <DemoProjectsView
            demoProjectId={demoProjectId}
        >
            {children}
        </DemoProjectsView>
    )
}