/* eslint-disable react-hooks/purity */
'use client'

import { useMutation } from "convex/react"
import { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"

/**
 *  更改project name hook
 * 
 *  接收要更改项目id
 * 
 *  @returns 返回一个mutation函数，该函数接收要更改后的name
 * 
 *  进行乐观更新,调用set、get函数操作本地浏览器的convex数据缓存
 * 
 */
export function useDemoReName(demoProjectId: Id<'projects'>) {
    return useMutation(api.projects.rename)
        .withOptimisticUpdate((localStore, args) => {

            // 更改api.projects.getById查询缓存
            const existingProject = localStore.getQuery(api.projects.getById, { id: demoProjectId })

            if (existingProject !== undefined && existingProject !== null) {
                localStore.setQuery(
                    api.projects.getById,
                    { id: demoProjectId },
                    {
                        ...existingProject,
                        name: args.name,
                        updatedAt: Date.now(),
                    }
                )
            }

            // 更改api.projects.get查询缓存
            const existingProjects = localStore.getQuery(api.projects.get)

            if (existingProjects !== undefined && existingProjects !== null) {
                localStore.setQuery(
                    api.projects.get,
                    {},
                    existingProjects.map(project => {
                        return project._id === args.id
                            ? { ...project, name: args.name, updatedAt: Date.now() }
                            : project
                    })
                )
            }
        })
}