import { IPromise, IHttpService } from 'angular';
import { config } from '../config';
import { GraphData } from '../entities/contract';
import { FrameService } from './frameService';
import { userFrame } from '../entities/frames';
import { User, AnonymousUser, DefaultUser } from '../entities/user';
import { IQService } from 'angular';
import { AbstractModel } from '../entities/model';
import { AbstractGroup } from '../entities/group';
import { Uri } from '../entities/uri';

export interface UserService {
  user: User;
  updateLogin(): IPromise<User>;
  ifStillLoggedIn(loggedInCallback: () => void, notLoggedInCallback: () => void): void;
  isLoggedIn(): boolean;
  logout(): IPromise<User>;
}

export class DefaultUserService {

  user: User = new AnonymousUser();

  /* @ngInject */
  constructor(private $http: IHttpService, private frameService: FrameService) {
  }

  updateLogin(): IPromise<User> {
    return this.$http.get<boolean>(config.apiEndpointWithName('loginstatus'))
      .then(statusResponse => statusResponse.data
        ? this.$http.get<GraphData>(config.apiEndpointWithName('user')).then(response => this.deserializeUser(response.data!))
        : new AnonymousUser())
      .then(updatedUser => this.user = updatedUser);
  }

  ifStillLoggedIn(loggedInCallback: () => void, notLoggedInCallback: () => void) {
    this.updateLogin().then(user => {
      if (user.isLoggedIn()) {
        loggedInCallback();
      } else {
        notLoggedInCallback();
      }
    });
  }

  isLoggedIn(): boolean {
    return this.user.isLoggedIn();
  }

  logout(): IPromise<User> {
    return this.$http.get(config.apiEndpointWithName('logout')).then(() => this.user = new AnonymousUser());
  }

  private deserializeUser(data: GraphData): IPromise<User> {
    return this.frameService.frameAndMap(data, true, userFrame(data), () => DefaultUser);
  }
}

class InteractiveHelpUser implements User {

  name: string|any = 'Ohjekäyttäjä';

  isLoggedIn(): boolean {
    return true;
  }

  isMemberOf(_entity: AbstractModel|AbstractGroup): boolean {
    return true;
  }

  isMemberOfGroup(_id: Uri): boolean {
    return true;
  }

  isAdminOf(_entity: AbstractModel|AbstractGroup): boolean {
    return false;
  }

  isAdminOfGroup(_id: Uri): boolean {
    return false;
  }
}

export class InteractiveHelpUserService {

  user = new InteractiveHelpUser();

  /* @ngInject */
  constructor(private $q: IQService) {
  }

  updateLogin(): IPromise<User> {
    return this.$q.when(this.user);
  }

  ifStillLoggedIn(loggedInCallback: () => void, _notLoggedInCallback: () => void): void {
    loggedInCallback();
  }

  isLoggedIn(): boolean {
    return true;
  }

  logout(): IPromise<User> {
    throw new Error('Should not be able to logout when in help');
  }
}
