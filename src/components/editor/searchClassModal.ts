import { IPromise, IScope, ui } from 'angular';
import IModalService = ui.bootstrap.IModalService;
import IModalServiceInstance = ui.bootstrap.IModalServiceInstance;
import * as _ from 'lodash';
import { SearchConceptModal, EntityCreation } from './searchConceptModal';
import {
  Class, ClassListItem, Model, DefinedBy, AbstractClass, ExternalEntity
} from '../../services/entities';
import { ClassService } from '../../services/classService';
import { LanguageService, Localizer } from '../../services/languageService';
import { comparingBoolean, comparingLocalizable } from '../../services/comparators';
import { AddNew } from '../common/searchResults';
import gettextCatalog = angular.gettext.gettextCatalog;
import { EditableForm } from '../form/editableEntityController';
import { collectIds, glyphIconClassForType } from '../../utils/entity';
import { any } from '../../utils/array';
import { valueContains } from '../../utils/searchFilter';
import { Exclusion } from '../../utils/exclusion';
import { isDefined } from '../../utils/object';

export const noExclude = (_item: AbstractClass) => null;
export const defaultTextForSelection = (_klass: Class) => 'Use class';

export class SearchClassModal {
  /* @ngInject */
  constructor(private $uibModal: IModalService) {
  }

  private openModal(model: Model, exclude: Exclusion<AbstractClass>, defaultToCurrentModel: boolean, onlySelection: boolean, textForSelection: (klass: Class) => string) {
    return this.$uibModal.open({
      template: require('./searchClassModal.html'),
      size: 'large',
      controller: SearchClassController,
      controllerAs: 'ctrl',
      backdrop: true,
      resolve: {
        model: () => model,
        exclude: () => exclude,
        defaultToCurrentModel: () => defaultToCurrentModel,
        onlySelection: () => onlySelection,
        textForSelection: () => textForSelection
      }
    }).result;
  }

  open(model: Model, exclude: Exclusion<AbstractClass>, textForSelection: (klass: Class) => string): IPromise<ExternalEntity|EntityCreation|Class> {
    return this.openModal(model, exclude, false, false, textForSelection);
  }

  openWithOnlySelection(model: Model, defaultToCurrentModel: boolean, exclude: Exclusion<AbstractClass>, textForSelection: (klass: Class) => string = defaultTextForSelection): IPromise<Class> {
    return this.openModal(model, exclude, defaultToCurrentModel, true, textForSelection);
  }
}

export interface SearchClassScope extends IScope {
  form: EditableForm;
}

class SearchClassController {

  private classes: ClassListItem[] = [];
  private currentModelClassIds: Set<string> = new Set<string>();

  close = this.$uibModalInstance.dismiss;
  searchResults: (ClassListItem|AddNewClass)[] = [];
  selection: Class|ExternalEntity;
  searchText: string = '';
  showProfiles: boolean = true;
  showModel: DefinedBy|Model;
  models: (DefinedBy|Model)[] = [];
  cannotConfirm: string;
  loadingResults: boolean;
  selectedItem: ClassListItem|AddNewClass;
  excludeError: string|null = null;

  // undefined means not fetched, null means does not exist
  externalClass: Class|null|undefined;

  private localizer: Localizer;

  contentMatchers = [
    { name: 'Label', extractor: (klass: ClassListItem) => klass.label },
    { name: 'Description', extractor: (klass: ClassListItem) => klass.comment },
    { name: 'Identifier', extractor: (klass: ClassListItem) => klass.id.compact }
  ];

  contentExtractors = this.contentMatchers.map(m => m.extractor);

  /* @ngInject */
  constructor(private $scope: SearchClassScope,
              private $uibModalInstance: IModalServiceInstance,
              private classService: ClassService,
              languageService: LanguageService,
              public model: Model,
              public exclude: (klass: AbstractClass) => string,
              defaultToCurrentModel: boolean,
              public onlySelection: boolean,
              public textForSelection: (klass: Class) => string,
              private searchConceptModal: SearchConceptModal,
              private gettextCatalog: gettextCatalog) {

    this.localizer = languageService.createLocalizer(model);
    this.loadingResults = true;

    if (defaultToCurrentModel) {
      this.showModel = model;
    }

    const appendResults = (classes: ClassListItem[]) => {
      this.classes = this.classes.concat(classes);

      const definedByFromClasses = _.chain(this.classes)
        .map(klass => klass.definedBy!)
        .filter(definedBy => isDefined(definedBy))
        .uniqBy(definedBy => definedBy!.id.toString())
        .value()
        .sort(comparingLocalizable<DefinedBy>(this.localizer, definedBy => definedBy.label));

      this.models = [this.model, ...definedByFromClasses];
      this.search();

      this.loadingResults = false;
    };

    classService.getAllClasses(model).then(appendResults);
    classService.getClassesAssignedToModel(model)
      .then(classes => this.currentModelClassIds = collectIds(classes))
      .then(() => this.search());

    if (model.isOfType('profile')) {
      classService.getExternalClassesForModel(model).then(appendResults);
    }

    $scope.$watch(() => this.searchText, () => this.search());
    $scope.$watch(() => this.showModel, () => this.search());
    $scope.$watch(() => this.showProfiles, () => this.search());
    $scope.$watchCollection(() => this.contentExtractors, () => this.search());

    $scope.$watch(() => this.selection && this.selection.id, selectionId => {
      if (selectionId && this.selection instanceof ExternalEntity) {
        this.externalClass = undefined;
        classService.getExternalClass(selectionId, model).then(klass => this.externalClass = klass);
      }
    });
  }

  isThisModel(item: DefinedBy|Model) {
    return this.model === item;
  }

  get showExcluded() {
    return !!this.searchText;
  }

  isSelectionExternalEntity(): boolean {
    return this.selection instanceof ExternalEntity;
  }

  search() {
    const result: (ClassListItem|AddNewClass)[] = [
      new AddNewClass(`${this.gettextCatalog.getString('Create new class')} '${this.searchText}'`, this.canAddNew.bind(this), false),
      new AddNewClass(`${this.gettextCatalog.getString('Create new shape')} ${this.gettextCatalog.getString('by referencing external uri')}`, () => this.canAddNew() && this.model.isOfType('profile'), true)
    ];

    const classSearchResult = this.classes.filter(klass =>
      this.textFilter(klass) &&
      this.modelFilter(klass) &&
      this.excludedFilter(klass) &&
      this.showProfilesFilter(klass)
    );

    classSearchResult.sort(
      comparingBoolean<ClassListItem>(item => !!this.exclude(item))
        .andThen(comparingLocalizable<ClassListItem>(this.localizer, item => item.label)));

    this.searchResults = result.concat(classSearchResult);
  }

  canAddNew() {
    return !this.onlySelection && !!this.searchText;
  }

  selectItem(item: ClassListItem|AddNewClass) {
    this.selectedItem = item;
    this.externalClass = undefined;
    this.excludeError = null;
    this.$scope.form.editing = false;
    this.$scope.form.$setPristine();

    if (item instanceof AddNewClass) {
      if (item.external) {
        this.$scope.form.editing = true;
        this.selection = new ExternalEntity(this.localizer.language, this.searchText, 'class');
      } else {
        this.createNewClass();
      }
    } else if (item instanceof ClassListItem) {
      this.cannotConfirm = this.exclude(item);

      if (isDefined(item.definedBy) && this.model.isNamespaceKnownToBeNotModel(item.definedBy.id.toString())) {
        this.classService.getExternalClass(item.id, this.model).then(result => this.selection = result);
      } else {
        this.classService.getClass(item.id, this.model).then(result => this.selection = result);
      }
    } else {
      throw new Error('Unsupported item: ' + item);
    }
  }

  loadingSelection(item: ClassListItem|AddNewClass) {
    const selection = this.selection;
    if (item instanceof ClassListItem) {
      return item === this.selectedItem && (!selection || (selection instanceof Class && !item.id.equals(selection.id)));
    } else {
      return false;
    }
  }

  isExternalClassPending() {
    return this.isSelectionExternalEntity() && this.externalClass === undefined;
  }

  confirm() {
    const selection = this.selection;

    if (selection instanceof Class) {
      this.$uibModalInstance.close(this.selection);
    } else if (selection instanceof ExternalEntity) {
      if (this.externalClass) {
        const exclude = this.exclude(this.externalClass);
        if (exclude) {
          this.excludeError = exclude;
        } else {
          this.$uibModalInstance.close(this.externalClass);
        }
      } else {
        this.$uibModalInstance.close(selection);
      }
    } else {
      throw new Error('Unsupported selection: ' + selection);
    }
  }

  createNewClass() {
    return this.searchConceptModal.openNewEntityCreation(this.model.vocabularies, this.model, 'class', this.searchText)
      .then(conceptCreation => this.$uibModalInstance.close(conceptCreation));
  }

  private textFilter(klass: ClassListItem): boolean {
    return !this.searchText || any(this.contentExtractors, extractor => valueContains(extractor(klass), this.searchText));
  }

  private modelFilter(klass: ClassListItem): boolean {
    if (!this.showModel) {
      return true;
    } else if (this.showModel === this.model) {
      return this.currentModelClassIds.has(klass.id.uri);
    } else {
      return isDefined(klass.definedBy) && klass.definedBy.id.equals(this.showModel.id);
    }
  }

  private excludedFilter(klass: ClassListItem): boolean {
    return this.showExcluded || !this.exclude(klass);
  }

  private showProfilesFilter(klass: ClassListItem): boolean {
    return this.showProfiles || !isDefined(klass.definedBy) || !klass.definedBy.isOfType('profile');
  }
}

class AddNewClass extends AddNew {
  constructor(public label: string, public show: () => boolean, public external: boolean) {
    super(label, show, glyphIconClassForType(['class']));
  }
}
