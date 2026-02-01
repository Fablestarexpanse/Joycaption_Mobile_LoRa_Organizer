import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { loadProject } from "@/lib/tauri";

export function useProjectImages() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const setIsLoadingProject = useProjectStore((s) => s.setIsLoadingProject);

  const query = useQuery({
    queryKey: ["project", "images", rootPath],
    queryFn: () => loadProject(rootPath!),
    enabled: !!rootPath,
  });

  const setProjectDataReady = useProjectStore((s) => s.setProjectDataReady);

  // Keep overlay up until query settles, then stay up a bit longer so the grid can render/load thumbnails
  useEffect(() => {
    if (query.isError) {
      setIsLoadingProject(false);
      setProjectDataReady(false);
      return;
    }
    if (query.isSuccess) {
      setProjectDataReady(true);
      const t = setTimeout(() => {
        setIsLoadingProject(false);
        setProjectDataReady(false);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [query.isSuccess, query.isError, setIsLoadingProject, setProjectDataReady]);

  return query;
}
