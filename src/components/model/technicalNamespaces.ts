import { IScope } from 'angular';
import { TableDescriptor, ColumnDescriptor } from '../form/editableTable';
import { module as mod }  from './module';
import { Model, Namespace, NamespaceType } from '../../entities/model';

mod.directive('technicalNamespaces', () => {
  return {
    scope: {
      model: '='
    },
    restrict: 'E',
    template: `
      <h4 translate>Technical namespaces</h4>
      <editable-table descriptor="ctrl.descriptor" expanded="ctrl.expanded"></editable-table>
    `,
    controllerAs: 'ctrl',
    bindToController: true,
    controller: TechnicalNamespacesController
  };
});

class TechnicalNamespacesController {
  model: Model;
  descriptor: TechnicalNamespaceTableDescriptor;
  expanded = false;

  /* @ngInject */
  constructor($scope: IScope) {
    $scope.$watch(() => this.model, model => {
      this.descriptor = new TechnicalNamespaceTableDescriptor(model);
    });
  }
}

class TechnicalNamespaceTableDescriptor extends TableDescriptor<Namespace> {

  namespaces: Namespace[];

  constructor(model: Model) {
    super();
    this.namespaces = model.getNamespaces().filter(ns => ns.type === NamespaceType.IMPLICIT_TECHNICAL);
  }

  columnDescriptors(): ColumnDescriptor<Namespace>[] {
    return [
      { headerName: 'Prefix', nameExtractor: ns => ns.prefix, cssClass: 'prefix' },
      { headerName: 'Namespace', nameExtractor: ns => ns.url }
    ];
  }

  values(): Namespace[] {
    return this.namespaces;
  }

  orderBy(ns: Namespace) {
    return ns.prefix;
  }

  canEdit(_ns: Namespace): boolean {
    return false;
  }

  canRemove(_ns: Namespace): boolean {
    return false;
  }
}
