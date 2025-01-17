import { join, normalize } from '@angular-devkit/core';
import {
  apply,
  chain,
  MergeStrategy,
  mergeWith,
  move,
  noop,
  Rule,
  SchematicContext,
  template,
  Tree,
  url,
} from '@angular-devkit/schematics';
import {
  getWorkspacePath,
  replaceAppNameWithPath,
  updateJsonInTree,
} from '@nrwl/workspace';
import * as path from 'path';
import { NormalizedSchema } from './normalized-schema';
import { updateNgPackage } from './update-ng-package';
import { offsetFromRoot } from '@nrwl/devkit';
import { libsDir } from '@nrwl/workspace/src/utils/ast-utils';

// TODO - refactor this into separate rules with better names
export function updateProject(options: NormalizedSchema): Rule {
  return chain([
    (host: Tree, _context: SchematicContext): Tree => {
      const libRoot = `${options.projectRoot}/src/lib/`;
      const serviceSpecPath = path.join(
        libRoot,
        `${options.name}.service.spec.ts`
      );
      const componentSpecPath = path.join(
        libRoot,
        `${options.name}.component.spec.ts`
      );

      host.delete(path.join(libRoot, `${options.name}.service.ts`));

      if (host.exists(serviceSpecPath)) {
        host.delete(serviceSpecPath);
      }

      host.delete(path.join(libRoot, `${options.name}.component.ts`));

      if (host.exists(componentSpecPath)) {
        host.delete(path.join(libRoot, `${options.name}.component.spec.ts`));
      }

      if (!options.publishable && !options.buildable) {
        host.delete(path.join(options.projectRoot, 'ng-package.json'));
        host.delete(path.join(options.projectRoot, 'package.json'));
        host.delete(path.join(options.projectRoot, 'tsconfig.lib.prod.json'));
      }

      host.delete(path.join(options.projectRoot, 'karma.conf.js'));
      host.delete(path.join(options.projectRoot, 'src/test.ts'));
      host.delete(path.join(options.projectRoot, 'tsconfig.spec.json'));

      host.delete(path.join(libRoot, `${options.name}.module.ts`));
      host.create(
        path.join(libRoot, `${options.fileName}.module.ts`),
        `
            import { NgModule } from '@angular/core';
            import { CommonModule } from '@angular/common';
            
            @NgModule({
              imports: [
                CommonModule
              ]
            })
            export class ${options.moduleName} { }
            `
      );

      if (options.unitTestRunner !== 'none' && options.addModuleSpec) {
        host.create(
          path.join(libRoot, `${options.fileName}.module.spec.ts`),
          `
        import { async, TestBed } from '@angular/core/testing';
        import { ${options.moduleName} } from './${options.fileName}.module';
        
        describe('${options.moduleName}', () => {
          beforeEach(async(() => {
            TestBed.configureTestingModule({
              imports: [ ${options.moduleName} ]
            })
            .compileComponents();
          }));
        
          // TODO: Add real tests here.
          //
          // NB: This particular test does not do anything useful. 
          //     It does NOT check for correct instantiation of the module.
          it('should have a module definition', () => {
            expect(${options.moduleName}).toBeDefined();
          });
        });
              `
        );
      }

      host.overwrite(
        `${options.projectRoot}/src/index.ts`,
        `
            export * from './lib/${options.fileName}.module';
            `
      );

      return host;
    },
    mergeWith(
      apply(url('./files/lib'), [
        template({
          ...options,
          offsetFromRoot: offsetFromRoot(options.projectRoot),
        }),
        move(options.projectRoot),
      ]),
      MergeStrategy.Overwrite
    ),
    (host: Tree) => {
      return updateJsonInTree(getWorkspacePath(host), (json) => {
        const project = json.projects[options.name];
        const fixedProject = replaceAppNameWithPath(
          project,
          options.name,
          options.projectRoot
        );

        delete fixedProject.schematics;

        if (!options.publishable && !options.buildable) {
          delete fixedProject.architect.build;
        } else {
          // Set the right builder for the type of library.
          // Ensure the outputs property comes after the builder for
          // better readability.
          const { builder, ...rest } = fixedProject.architect.build;
          fixedProject.architect.build = {
            builder: options.publishable
              ? '@nrwl/angular:package'
              : '@nrwl/angular:ng-packagr-lite',
            outputs: [`dist/${libsDir(host)}/${options.projectDirectory}`],
            ...rest,
          };
        }

        delete fixedProject.architect.test;

        json.projects[options.name] = fixedProject;
        return json;
      });
    },
    updateJsonInTree(`${options.projectRoot}/tsconfig.lib.json`, (json) => {
      if (options.unitTestRunner === 'jest') {
        json.exclude = ['src/test-setup.ts', '**/*.spec.ts'];
      } else if (options.unitTestRunner === 'none') {
        json.exclude = [];
      } else {
        json.exclude = json.exclude || [];
      }

      return {
        ...json,
        extends: `./tsconfig.json`,
        compilerOptions: {
          ...json.compilerOptions,
          outDir: `${offsetFromRoot(options.projectRoot)}dist/out-tsc`,
        },
      };
    }),
    updateJsonInTree(`/nx.json`, (json) => ({
      ...json,
      projects: {
        ...json.projects,
        [options.name]: { tags: options.parsedTags },
      },
    })),
    (host: Tree) => updateNgPackage(host, options),
  ]);
}
