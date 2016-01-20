import IAttributes = angular.IAttributes;
import IScope = angular.IScope;
import IPromise = angular.IPromise;
import ILogService = angular.ILogService;
import * as _ from 'lodash';
import { ModelController } from '../model/modelController';
import { EditableEntityController, EditableScope, Rights } from '../form/editableEntityController';
import { ClassFormController } from './classForm';
import { ClassService } from '../../services/classService';
import { Class, GroupListItem, Model, Property, Uri, states } from '../../services/entities';
import { SearchPredicateModal } from './searchPredicateModal';
import { UserService } from '../../services/userService';
import { DeleteConfirmationModal } from '../common/deleteConfirmationModal';

export const mod = angular.module('iow.components.editor');

mod.directive('classView', () => {
  'ngInject';
  return {
    scope: {
      class: '=',
      model: '='
    },
    restrict: 'E',
    template: require('./classView.html'),
    controllerAs: 'ctrl',
    bindToController: true,
    require: ['classView', '^ngController'],
    link($scope: EditableScope, element: JQuery, attributes: IAttributes, controllers: any[]) {
      $scope.modelController = controllers[1];
      $scope.modelController.registerView(controllers[0]);
    },
    controller: ClassViewController
  }
});

export class ClassViewController extends EditableEntityController<Class> {

  private classForm: ClassFormController;
  class: Class;
  model: Model;

  /* @ngInject */
  constructor($scope: EditableScope,
              $log: ILogService,
              deleteConfirmationModal: DeleteConfirmationModal,
              private classService: ClassService,
              private searchPredicateModal: SearchPredicateModal,
              userService: UserService) {
    super($scope, $log, deleteConfirmationModal, userService);
  }

  registerForm(form: ClassFormController) {
    this.classForm = form;
  }

  addProperty() {
    const existingPredicates = new Set<Uri>(_.map(this.class.properties, property => property.predicateId));

    this.searchPredicateModal.openForProperty(this.model, existingPredicates)
      .then(predicate => this.classService.newProperty(predicate.id, this.editableInEdit.properties.length))
      .then(property => {
        this.editableInEdit.addProperty(property);
        this.classForm.openPropertyAndScrollTo(property);
      });
  }

  removeProperty(property: Property) {
    this.editableInEdit.removeProperty(property);
  }

  create(entity: Class) {
    return this.classService.createClass(entity);
  }

  update(entity: Class, oldId: string) {
    return this.classService.updateClass(entity, oldId);
  }

  remove(entity: Class) {
    return this.classService.deleteClass(entity.id, this.model.id);
  }

  rights(): Rights {
    return {
      edit: () => this.isNotReference(),
      remove: () => this.isReference() || this.class.state === states.unstable
    };
  }

  getEditable(): Class {
    return this.class;
  }

  setEditable(editable: Class) {
    this.class = editable;
  }

  isNotReference(): boolean {
    return this.class.definedBy.id === this.model.id;
  }

  getGroup(): GroupListItem {
    return this.model.group;
  }

  getRemoveText(): string {
    const text = super.getRemoveText();
    return this.isNotReference() ? text : text + ' from this ' + this.model.type;
  }
}
