import IPromise = angular.IPromise;
import IQService = angular.IQService;
import * as _ from 'lodash';
import {
  Localizable,
  Uri,
  Type,
  Model,
  Predicate,
  Attribute,
  Association,
  Class,
  Property,
  State,
  Curie,
  ConceptSuggestion,
  ConstraintType
} from './entities';
import { ModelService } from './modelService';
import { ClassService } from './classService';
import { PredicateService } from './predicateService';
import { UserService } from './userService';
import { splitCurie } from './utils';
import { ConceptService } from './conceptService';
import { ResetService } from './resetService';

export const asiaConceptId = 'http://jhsmeta.fi/skos/J392';
export const ktkGroupId = 'https://tt.eduuni.fi/sites/csc-iow#KTK';
export const jhsGroupId = 'https://tt.eduuni.fi/sites/csc-iow#JHS';

export type Resolvable<T> = IPromise<T>|(() => IPromise<T>);
export type CurieResolvable<T extends { curie: Curie }> = Curie|IPromise<T>|(() => IPromise<T>);

export interface EntityDetails {
  label: Localizable;
  comment?: Localizable;
  state?: State;
}

export interface ExternalRequireDetails {
  prefix: string;
  namespace: Uri;
  label: string;
}

export interface ModelDetails extends EntityDetails {
  prefix: string,
  references?: string[];
  requires?: (Resolvable<Model>|ExternalRequireDetails)[]
}

export interface ConstraintDetails {
  type: ConstraintType;
  comment: Localizable;
  shapes: Resolvable<Class>[];
}

export interface ClassDetails extends EntityDetails {
  id?: string,
  subClassOf?: CurieResolvable<Class>;
  concept?: Uri|ConceptSuggestionDetails;
  equivalentClasses?: CurieResolvable<Class>[];
  properties?: PropertyDetails[];
  constraint?: ConstraintDetails;
}

export interface ShapeDetails extends EntityDetails {
  class: Resolvable<Class>;
  id?: string,
  equivalentClasses?: CurieResolvable<Class>[];
  properties?: PropertyDetails[];
  constraint?: ConstraintDetails;
}

export interface PredicateDetails extends EntityDetails {
  id?: string,
  subPropertyOf?: CurieResolvable<Predicate>;
  concept?: Uri|ConceptSuggestionDetails;
  equivalentProperties?: CurieResolvable<Predicate>[];
}

export interface AttributeDetails extends PredicateDetails {
  dataType?: string;
}

export interface AssociationDetails extends PredicateDetails {
  valueClass?: CurieResolvable<Class>;
}

export interface PropertyDetails extends EntityDetails {
  predicate: Resolvable<Predicate>;
  example?: string;
  dataType?: string;
  valueClass?: CurieResolvable<Class>;
  minCount?: number;
  maxCount?: number;
  pattern?: string;
}

export interface ConceptSuggestionDetails {
  label: string;
  comment: string;
}

export class EntityLoaderService {
  /* @ngInject */
  constructor(private $q: IQService,
              private modelService: ModelService,
              private predicateService: PredicateService,
              private classService: ClassService,
              private userService: UserService,
              private conceptService: ConceptService,
              private resetService: ResetService) {
  }

  create(shouldReset: boolean): EntityLoader {
    return new EntityLoader(this.$q, this.modelService, this.predicateService, this.classService, this.userService, this.conceptService, this.resetService, shouldReset);
  }
}

export class EntityLoader {

  private reset: IPromise<any>;
  private loggedIn: IPromise<any>;
  private schemes: IPromise<any>;
  private entities: IPromise<any>[] = [];

  constructor(private $q: IQService,
              private modelService: ModelService,
              private predicateService: PredicateService,
              private classService: ClassService,
              private userService: UserService,
              private conceptService: ConceptService,
              private resetService: ResetService,
              private shouldReset: boolean) {

    this.reset = shouldReset ? resetService.reset() : $q.when();
    this.loggedIn = this.reset.then(() => userService.login());
    this.schemes = this.reset.then(() => this.conceptService.getAllSchemes('fi')).then(result => result.data.vocabularies);
  }

  addAction(action: IPromise<any>, details: any) {
    this.entities.push(action.then(identity, failWithDetails(details)));
  }

  result(successCallback: () => void, errorCallback: (err: any) => void) {
    this.$q.all(this.entities).then(successCallback, errorCallback);
  }

  createConceptSuggestion(details: ConceptSuggestionDetails): IPromise<ConceptSuggestion> {
    const result = this.loggedIn
      .then(() => this.conceptService.createConceptSuggestion("http://www.finto.fi/jhsmeta", details.label, details.comment, null, 'fi'))
      .then(conceptId => this.conceptService.getConceptSuggestion(conceptId));

    this.addAction(result, details);
    return result;
  }

  private createModel(type: Type, groupId: Uri, details: ModelDetails): IPromise<Model> {
    const result = this.loggedIn
      .then(() => this.modelService.newModel(details.prefix, details.label['fi'], groupId, 'fi', type))
      .then(model => {
        setDetails(model, details);

        const promises: IPromise<any>[] = [];

        for (var reference of details.references || []) {
          promises.push(
            this.schemes.then((schemes: any) => {
                const scheme = _.find(schemes, (scheme: any) => scheme.id === reference);
                if (!scheme) {
                  throw new Error('Reference not found: ' + reference);
                }
                return scheme;
              })
              .then(scheme => this.modelService.newReference(scheme, 'fi', model.context))
              .then(referenceEntity => model.addReference(referenceEntity))
          );
        }

        for (const require of details.requires || []) {

          if (isCurieResolvable(require)) {
            promises.push(
              asPromise(assertExists(require, 'require for ' + model.label['fi']))
                .then(requiredModel => this.modelService.newRequire(requiredModel.namespace, requiredModel.prefix, requiredModel.label['fi'], 'fi'))
                .then(newRequire => model.addRequire(newRequire))
            );
          } else if (isExternalRequire(require)) {
            promises.push(this.modelService.newRequire(require.namespace, require.prefix, require.label, 'fi')
              .then(newRequire => model.addRequire(newRequire))
            );
          } else {
            throw new Error('Unknown require: ' + require);
          }
        }

        return this.$q.all(promises)
          .then(() => this.modelService.createModel(model))
          .then(() => model);
      });

    this.addAction(result, details);
    return result;
  }

  createLibrary(groupId: Uri, details: ModelDetails): IPromise<Model> {
    return this.createModel('library', groupId, details);
  }

  createProfile(groupId: Uri, details: ModelDetails): IPromise<Model> {
    return this.createModel('profile', groupId, details);
  }

  assignClass(modelPromise: IPromise<Model>, classPromise: IPromise<Class>): IPromise<Class> {
    const result = this.loggedIn
      .then(() => this.$q.all([modelPromise, classPromise]))
      .then(([model, klass]: [Model, Class]) => this.classService.assignClassToModel(klass.id, model.id).then(() => klass));

    this.addAction(result, 'assign class');
    return result;
  }

  specializeClass(modelPromise: IPromise<Model>, details: ShapeDetails): IPromise<Class> {
    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, asPromise(assertExists(details.class, 'class to specialize for ' + details.label['fi']))]))
      .then(([model, klass]: [Model, Class]) => {
        return this.classService.newShape(klass.id, model, 'fi')
          .then(shape => {
            setDetails(shape, details);
            setId(shape, details);

            const promises: IPromise<any>[] = [];

            for (const property of details.properties || []) {
              promises.push(this.createProperty(property).then(property => {
                shape.addProperty(property);
              }));
            }

            for (const equivalentClass of details.equivalentClasses || []) {
              promises.push(asCuriePromise(assertExists(equivalentClass, 'equivalent class for ' + details.label['fi'])).then(curie => shape.equivalentClasses.push(curie)));
            }

            if (details.constraint) {
              shape.constraint.constraint = details.constraint.type;
              shape.constraint.comment = details.constraint.comment;

              for (const constraintShape of details.constraint.shapes) {
                promises.push(asPromise(assertExists(constraintShape, 'constraint item for ' + details.label['fi'])).then(item => shape.constraint.addItem(item)));
              }
            }

            return this.$q.all(promises)
              .then(() => this.classService.createClass(shape))
              .then(() => shape)
          })
      });

    this.addAction(result, details);
    return result;
  }

  createClass(modelPromise: IPromise<Model>, details: ClassDetails): IPromise<Class> {

    const concept = details.concept;
    const conceptIdPromise = isConceptSuggestion(concept)
      ? this.createConceptSuggestion(concept).then(conceptSuggestion => conceptSuggestion.id)
      : this.$q.when(concept || asiaConceptId);

    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, conceptIdPromise]))
      .then(([model, conceptId]: [Model, Uri]) => this.classService.newClass(model, details.label['fi'], conceptId || asiaConceptId, 'fi'))
      .then((klass: Class) => {
        setDetails(klass, details);
        setId(klass, details);

        const promises: IPromise<any>[] = [];

        for (const property of details.properties || []) {
          promises.push(this.createProperty(property).then(property => klass.addProperty(property)));
        }

        assertPropertyValueExists(details, 'subClassOf for ' + details.label['fi']);
        promises.push(asCuriePromise(details.subClassOf).then(curie => klass.subClassOf = curie));

        for (const equivalentClass of details.equivalentClasses || []) {
          promises.push(asCuriePromise(assertExists(equivalentClass, 'equivalent class for ' + details.label['fi'])).then(curie => klass.equivalentClasses.push(curie)));
        }

        if (details.constraint) {
          klass.constraint.constraint = details.constraint.type;
          klass.constraint.comment = details.constraint.comment;

          for (const constraintShape of details.constraint.shapes) {
            promises.push(asPromise(assertExists(constraintShape, 'constraint item for ' + details.label['fi'])).then(item => klass.constraint.addItem(item)));
          }
        }

        return this.$q.all(promises)
          .then(() => this.classService.createClass(klass))
          .then(() => klass)
      });

    this.addAction(result, details);
    return result;
  }

  assignPredicate(modelPromise: IPromise<Model>, predicatePromise: IPromise<Predicate>): IPromise<Predicate> {
    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, predicatePromise]))
      .then(([model, predicate]: [Model, Predicate]) => this.predicateService.assignPredicateToModel(predicate.id, model.id).then(() => predicate));

    this.addAction(result, 'assign predicate');
    return result;
  }

  createPredicate<T extends Predicate>(modelPromise: IPromise<Model>, type: Type, details: PredicateDetails, mangler: (predicate: T) => IPromise<any>): IPromise<T> {

    const concept = details.concept;
    const conceptIdPromise = isConceptSuggestion(concept)
      ? this.createConceptSuggestion(concept).then(conceptSuggestion => conceptSuggestion.id)
      : this.$q.when(concept || asiaConceptId);

    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, conceptIdPromise]))
      .then(([model, conceptId]: [Model, Uri]) => this.predicateService.newPredicate(model, details.label['fi'], conceptId || asiaConceptId, type, 'fi'))
      .then((predicate: T) => {
        setDetails(predicate, details);
        setId(predicate, details);

        const promises: IPromise<any>[] = [];

        assertPropertyValueExists(details, 'subPropertyOf for ' + details.label['fi]']);
        promises.push(asCuriePromise(details.subPropertyOf).then(curie => predicate.subPropertyOf = curie));

        for (const equivalentProperty of details.equivalentProperties || []) {
          promises.push(asCuriePromise(assertExists(equivalentProperty, 'equivalent property for ' + details.label['fi'])).then(curie => predicate.equivalentProperties.push(curie)));
        }

        promises.push(mangler(predicate));

        return this.$q.all(promises)
          .then(() => this.predicateService.createPredicate(predicate))
          .then(() => predicate);
      });

    this.addAction(result, details);
    return result;
  }

  createAttribute(modelPromise: IPromise<Model>, details: AttributeDetails): IPromise<Attribute> {
    return this.createPredicate<Attribute>(modelPromise, 'attribute', details, attribute => {
      attribute.dataType = details.dataType;
      return this.$q.when();
    });
  }

  createAssociation(modelPromise: IPromise<Model>, details: AssociationDetails): IPromise<Association> {
    return this.createPredicate<Association>(modelPromise, 'association', details, association => {
      assertPropertyValueExists(details, 'valueClass for association ' + details.label['fi']);
      return asCuriePromise(details.valueClass)
        .then(curie => association.valueClass = curie);
    });
  }

  createProperty(details: PropertyDetails): IPromise<Property> {
    const result = this.loggedIn
      .then(() =>  asPromise(assertExists(details.predicate, 'predicate')))
      .then(p => this.classService.newProperty(p.id))
      .then((p: Property) => {
        setDetails(p, details);
        assertPropertyValueExists(details, 'valueClass for property ' + details.label['fi']);
        const valueClassPromise = asCuriePromise(details.valueClass).then(curie => {
          if (curie) {
            p.valueClass = curie;
          }
        });

        if (details.dataType) {
          p.dataType = details.dataType;
        }

        p.example = details.example;
        p.minCount = details.minCount;
        p.maxCount = details.maxCount;
        p.pattern = details.pattern;

        return valueClassPromise.then(() => p);
      });

    this.addAction(result, details);
    return result;
  }
}

function identity<T>(obj: T): T {
  return obj;
}

function failWithDetails(details: any): (err: any) => void {
  return (error: any) => {
    return Promise.reject({ error, details });
  }
}

function setDetails(entity: { label: Localizable, comment: Localizable, state: State }, details: EntityDetails) {
  entity.label = details.label;
  entity.comment = details.comment;
  if (details.state) {
    entity.state = details.state;
  }
}

function setId(entity: { curie: Curie }, details: { id?: string }) {
  if (details.id) {
    const {prefix} = splitCurie(entity.curie);
    entity.curie = prefix + ':' + details.id;
  }
}

function assertPropertyValueExists(obj: any, property: string) {
  if (obj.hasOwnProperty(property)) {
    return assertExists(obj[property], ' property: ' + property);
  }

  return obj[property];
}

function assertExists<T>(obj: T, msg: string): T {
  if (obj === null || obj === undefined) {
    throw new Error('Null or undefined: ' + msg);
  }
  return obj;
}

function isPromise<T>(obj:any): obj is IPromise<T> {
  return !!(obj && obj.then);
}

function isPromiseProvider<T>(obj:any): obj is (() => IPromise<T>) {
  return typeof obj === 'function';
}

function isConceptSuggestion(obj: any): obj is ConceptSuggestionDetails {
  return typeof obj === 'object';
}

function isExternalRequire(obj: any): obj is ExternalRequireDetails {
  return !!obj.label && !!obj.namespace && !!obj.prefix;
}

function isCurieResolvable<T>(obj: any): obj is CurieResolvable<T> {
  return isPromiseProvider(obj) || isPromise(obj);
}

function asCuriePromise<T extends { curie: Curie }>(resolvable: CurieResolvable<T>): IPromise<Curie> {
  if (isPromiseProvider(resolvable)) {
    const promise = resolvable();
    if (isPromise<T>(promise)) {
      return promise.then(withCurie => withCurie.curie);
    } else {
      throw new Error('Must be promise');
    }
  } else if (isPromise(resolvable)) {
    return resolvable.then(withCurie => withCurie.curie);
  } else if (typeof resolvable === 'string') {
    return <IPromise<Curie>> Promise.resolve(resolvable);
  } else {
    return <IPromise<Curie>> Promise.resolve(null);
  }
}

function asPromise<T>(resolvable: Resolvable<T>): IPromise<T> {
  if (isPromiseProvider<T>(resolvable)) {
    return resolvable();
  } else if (isPromise<T>(resolvable)) {
    return resolvable;
  } else {
    throw new Error('Not resolvable: ' + resolvable);
  }
}