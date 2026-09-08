import { ProjectsView } from "@/features/projects/components/projects-view";
import { UserButton } from "@clerk/nextjs";

const Home = () => {
  return (
    <div>
      <ProjectsView />
    </div>
  );
};

export default Home;
